// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./interfaces/IERC8004Identity.sol";

/**
 * @title ClawCardNFT
 * @notice Unhackable ERC-8004 Agent Passport on Base.
 *
 *         SECURITY MODEL:
 *         1. HARD SOULBOUND    — All transfers revert, always, no exceptions.
 *         2. ONE PER WALLET    — Cannot mint twice to same address.
 *         3. ROLE-BASED ACCESS — MINTER_ROLE, ORACLE_ROLE, PAUSER_ROLE.
 *         4. ORACLE SIGNATURES — Reputation updates require a signed oracle message.
 *         5. REPLAY PROTECTION — Signature timestamp + chain ID + signature hash used.
 *         6. EMERGENCY PAUSE   — Admin can freeze mint/update instantly.
 */
contract ClawCardNFT is ERC721, AccessControl, Pausable, ReentrancyGuard, IERC8004Identity {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ORACLE_ROLE  = keccak256("ORACLE_ROLE");
    bytes32 public constant PAUSER_ROLE  = keccak256("PAUSER_ROLE");

    uint256 private _nextTokenId = 1;
    string  public  baseTokenURI;
    uint256 public  constant MAX_SUPPLY         = 1_000_000;
    uint256 public  constant UPDATE_COOLDOWN    = 1 hours;
    uint256 public  constant SIG_FRESHNESS_WINDOW = 5 minutes;
    uint256 public  constant MAX_FUSED_SCORE    = 10_000;

    // ─── On-chain Passport Data ──────────────────────────────────────
    struct PassportData {
        string  moltDomain;        // "jarvis.molt" — .molt name
        string  handle;            // legacy handle / agentId
        string  metadataUri;       // IPFS metadata URI
        string[]skills;            // capability list
        uint8   tier;              // 0=Hatchling … 4=Diamond Claw
        uint256 fusedScore;        // 0-10000 (scaled ×100 for precision)
        uint256 onChainScore;      // 45% component
        uint256 moltbookScore;     // 25% component
        uint256 performanceScore;  // 20% component
        uint256 bondScore;         // 10% component
        uint256 gigsCompleted;     // oracle-verified count
        uint256 totalEarnedUsdc;   // USDC base units
        uint256 riskIndex;         // 0-100
        uint8   bondStatus;        // 0=UNBONDED 1=BONDED 2=HIGH
        bool    active;            // false only if admin-deactivated
        uint256 lastUpdated;
        uint256 registeredAt;
    }

    mapping(uint256 => PassportData) public passports;
    mapping(address => uint256) public walletToTokenId;
    mapping(uint256 => address) public tokenIdToWallet;
    mapping(string  => uint256) public moltDomainToTokenId;
    mapping(string  => bool)    public moltDomainUsed;
    mapping(string  => uint256) public handleToToken;   // legacy agentId lookup
    mapping(string  => bool)    public handleUsed;
    mapping(bytes32 => bool)    private _usedSigHashes;

    // ─── Events ─────────────────────────────────────────────────────
    event PassportMinted(address indexed wallet, uint256 indexed tokenId, uint256 timestamp);
    event ReputationUpdated(uint256 indexed tokenId, uint256 fusedScore, uint8 tier, uint256 timestamp);
    event TierChanged(uint256 indexed tokenId, uint8 oldTier, uint8 newTier);
    event MoltDomainSet(uint256 indexed tokenId, string moltDomain);
    event PassportDeactivated(uint256 indexed tokenId, string reason);
    event BaseURIUpdated(string newBaseURI);

    // ERC-8004 event (IdentityRegistered inherited from IERC8004Identity)
    event IdentityUpdated(uint256 indexed tokenId, string field, string value);

    // ─── Errors ─────────────────────────────────────────────────────
    error SoulboundNonTransferable();
    error AlreadyMinted();
    error InvalidAddress();
    error MoltDomainInUse();
    error InvalidMoltDomain();
    error AgentIdInUse();
    error InvalidAgentId();
    error InvalidScore();
    error InvalidTier();
    error InvalidRiskIndex();
    error UpdateTooFrequent();
    error InvalidOracleSignature();
    error SignatureExpired();
    error SignatureAlreadyUsed();
    error PassportNotFound();
    error MaxSupplyReached();
    error InvalidBaseURI();
    error NotTokenOwner();
    error TokenIsSoulbound();

    constructor(string memory _baseTokenURI) ERC721("ClawTrust Passport", "CLAW") {
        if (bytes(_baseTokenURI).length == 0) revert InvalidBaseURI();
        baseTokenURI = _baseTokenURI;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE,        msg.sender);
        _grantRole(ORACLE_ROLE,        msg.sender);
        _grantRole(PAUSER_ROLE,        msg.sender);
    }

    // ─── HARD SOULBOUND ─────────────────────────────────────────────
    // Every possible transfer path is blocked. No exceptions.

    function transferFrom(address, address, uint256) public pure override {
        revert SoulboundNonTransferable();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert SoulboundNonTransferable();
    }

    function approve(address, uint256) public pure override {
        revert SoulboundNonTransferable();
    }

    // Belt-and-suspenders: _update is the OZ v5 internal hook for all token state changes.
    // Blocking here ensures even internal transfers are impossible.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            revert SoulboundNonTransferable();
        }
        return super._update(to, tokenId, auth);
    }

    function setApprovalForAll(address, bool) public pure override {
        revert SoulboundNonTransferable();
    }

    // ─── MINT ───────────────────────────────────────────────────────

    /**
     * @notice Mint a passport to msg.sender.
     *         Minter calls on behalf of the agent.
     *         `makeSoulbound` param kept for API compat — all passports are always soulbound.
     */
    function mint(string calldata agentId, bool /*makeSoulbound*/) external onlyRole(MINTER_ROLE) whenNotPaused nonReentrant {
        _mintPassport(msg.sender, agentId, "", new string[](0));
    }

    /**
     * @notice Admin mint to any address.
     */
    function adminMint(address to, string calldata agentId, bool /*makeSoulbound*/) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused nonReentrant {
        _mintPassport(to, agentId, "", new string[](0));
    }

    /**
     * @notice Admin mint with full ERC-8004 metadata.
     */
    function adminMintFull(
        address to,
        string calldata agentId,
        string calldata metadataUri,
        string[] calldata skills
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused nonReentrant {
        _mintPassport(to, agentId, metadataUri, skills);
    }

    // ERC-8004 registerIdentity — mints to msg.sender
    function registerIdentity(
        string calldata handle,
        string calldata metadataUri,
        string[] calldata skills
    ) external override onlyRole(MINTER_ROLE) whenNotPaused nonReentrant returns (uint256) {
        return _mintPassport(msg.sender, handle, metadataUri, skills);
    }

    function _mintPassport(
        address to,
        string memory agentId,
        string memory metadataUri,
        string[] memory skills
    ) internal returns (uint256) {
        if (to == address(0)) revert InvalidAddress();
        if (walletToTokenId[to] != 0) revert AlreadyMinted();
        if (bytes(agentId).length == 0) revert InvalidAgentId();
        if (handleUsed[agentId]) revert AgentIdInUse();
        if (_nextTokenId > MAX_SUPPLY) revert MaxSupplyReached();

        uint256 tokenId = _nextTokenId++;
        _mint(to, tokenId);

        passports[tokenId] = PassportData({
            moltDomain:      "",
            handle:          agentId,
            metadataUri:     metadataUri,
            skills:          skills,
            tier:            0,
            fusedScore:      0,
            onChainScore:    0,
            moltbookScore:   0,
            performanceScore:0,
            bondScore:       0,
            gigsCompleted:   0,
            totalEarnedUsdc: 0,
            riskIndex:       0,
            bondStatus:      0,
            active:          true,
            lastUpdated:     block.timestamp,
            registeredAt:    block.timestamp
        });

        walletToTokenId[to]  = tokenId;
        tokenIdToWallet[tokenId] = to;
        handleUsed[agentId]  = true;
        handleToToken[agentId] = tokenId;

        emit PassportMinted(to, tokenId, block.timestamp);
        emit IdentityRegistered(tokenId, to, agentId);
        return tokenId;
    }

    // ─── REPUTATION UPDATE (Oracle-signed) ─────────────────────────

    /**
     * @notice Update on-chain reputation. Requires a fresh oracle signature.
     *
     *         The oracle signs:
     *           keccak256(abi.encodePacked(
     *             tokenId, fusedScore, tier, gigsCompleted,
     *             totalEarned, riskIndex, sigTimestamp, block.chainid
     *           ))
     *
     *         Defenses:
     *           - Signature must be from ORACLE_ROLE holder
     *           - sigTimestamp must be within 5-minute freshness window
     *           - Each signature hash can only be used once (replay protection)
     *           - Rate-limited: max 1 update per hour per token
     *           - Bounds-checked: score ≤ 10000, tier ≤ 4, riskIndex ≤ 100
     */
    function updateReputation(
        uint256 tokenId,
        uint256 fusedScore,
        uint8   tier,
        uint256 gigsCompleted,
        uint256 totalEarned,
        uint256 riskIndex,
        uint256 sigTimestamp,
        bytes calldata oracleSignature
    ) external whenNotPaused {
        if (tokenIdToWallet[tokenId] == address(0)) revert PassportNotFound();
        if (fusedScore > MAX_FUSED_SCORE) revert InvalidScore();
        if (tier > 4) revert InvalidTier();
        if (riskIndex > 100) revert InvalidRiskIndex();
        if (block.timestamp > sigTimestamp + SIG_FRESHNESS_WINDOW) revert SignatureExpired();
        if (block.timestamp < passports[tokenId].lastUpdated + UPDATE_COOLDOWN) revert UpdateTooFrequent();

        bytes32 msgHash = keccak256(abi.encodePacked(
            tokenId, fusedScore, tier, gigsCompleted,
            totalEarned, riskIndex, sigTimestamp, block.chainid
        ));

        if (_usedSigHashes[msgHash]) revert SignatureAlreadyUsed();

        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        address signer  = ECDSA.recover(ethHash, oracleSignature);

        if (!hasRole(ORACLE_ROLE, signer)) revert InvalidOracleSignature();

        _usedSigHashes[msgHash] = true;

        PassportData storage p = passports[tokenId];
        uint8 oldTier = p.tier;

        p.fusedScore      = fusedScore;
        p.tier            = tier;
        p.gigsCompleted   = gigsCompleted;
        p.totalEarnedUsdc = totalEarned;
        p.riskIndex       = riskIndex;
        p.lastUpdated     = block.timestamp;

        emit ReputationUpdated(tokenId, fusedScore, tier, block.timestamp);
        if (tier != oldTier) emit TierChanged(tokenId, oldTier, tier);
    }

    // ─── MOLT DOMAIN ────────────────────────────────────────────────

    /**
     * @notice Set or update the .molt domain for a passport.
     *         Must end in ".molt". Length 6-37 chars.
     *         Only the passport owner or an ORACLE_ROLE holder may call.
     */
    function setMoltDomain(uint256 tokenId, string calldata moltDomain) external {
        if (tokenIdToWallet[tokenId] == address(0)) revert PassportNotFound();
        if (
            tokenIdToWallet[tokenId] != msg.sender &&
            !hasRole(ORACLE_ROLE, msg.sender)
        ) revert InvalidOracleSignature();

        _validateMoltDomain(moltDomain);
        if (moltDomainUsed[moltDomain]) revert MoltDomainInUse();

        string memory oldDomain = passports[tokenId].moltDomain;
        if (bytes(oldDomain).length > 0) {
            delete moltDomainToTokenId[oldDomain];
            moltDomainUsed[oldDomain] = false;
        }

        passports[tokenId].moltDomain = moltDomain;
        moltDomainToTokenId[moltDomain] = tokenId;
        moltDomainUsed[moltDomain] = true;

        emit MoltDomainSet(tokenId, moltDomain);
        emit IdentityUpdated(tokenId, "moltDomain", moltDomain);
    }

    function _validateMoltDomain(string calldata d) internal pure {
        bytes memory b = bytes(d);
        if (b.length < 6 || b.length > 37) revert InvalidMoltDomain();
        if (
            b[b.length-5] != '.' ||
            b[b.length-4] != 'm' ||
            b[b.length-3] != 'o' ||
            b[b.length-2] != 'l' ||
            b[b.length-1] != 't'
        ) revert InvalidMoltDomain();
    }

    // ─── ERC-8004 Identity Interface ────────────────────────────────

    function getIdentity(uint256 tokenId) external view override returns (AgentMetadata memory) {
        if (tokenIdToWallet[tokenId] == address(0)) revert PassportNotFound();
        PassportData storage p = passports[tokenId];
        return AgentMetadata({
            handle:      p.handle,
            metadataUri: p.metadataUri,
            skills:      p.skills,
            registeredAt:p.registeredAt
        });
    }

    function getIdentityByHandle(string calldata handle) external view override returns (
        uint256 tokenId,
        AgentMetadata memory metadata
    ) {
        if (!handleUsed[handle]) revert InvalidAgentId();
        tokenId = handleToToken[handle];
        PassportData storage p = passports[tokenId];
        metadata = AgentMetadata({
            handle:      p.handle,
            metadataUri: p.metadataUri,
            skills:      p.skills,
            registeredAt:p.registeredAt
        });
    }

    function updateMetadata(uint256 tokenId, string calldata newUri) external override {
        if (tokenIdToWallet[tokenId] != msg.sender) revert NotTokenOwner();
        if (bytes(newUri).length == 0) revert InvalidBaseURI();
        passports[tokenId].metadataUri = newUri;
        emit IdentityUpdated(tokenId, "metadataUri", newUri);
    }

    function ownerOfIdentity(uint256 tokenId) external view override returns (address) {
        return ownerOf(tokenId);
    }

    function isRegistered(address agent) external view override returns (bool) {
        return walletToTokenId[agent] != 0;
    }

    // ─── Passport View Functions ─────────────────────────────────────

    function getPassportByWallet(address wallet) external view returns (PassportData memory, uint256 tokenId) {
        tokenId = walletToTokenId[wallet];
        if (tokenId == 0) revert PassportNotFound();
        return (passports[tokenId], tokenId);
    }

    function getPassportById(uint256 tokenId) external view returns (PassportData memory) {
        if (tokenIdToWallet[tokenId] == address(0)) revert PassportNotFound();
        return passports[tokenId];
    }

    function getPassportByMoltDomain(string calldata moltDomain) external view returns (PassportData memory) {
        uint256 tokenId = moltDomainToTokenId[moltDomain];
        if (tokenId == 0) revert PassportNotFound();
        return passports[tokenId];
    }

    /**
     * @notice Quick trust check — used by x402 trust-check endpoint.
     */
    function isTrusted(address wallet) external view returns (
        bool trusted,
        uint256 score,
        uint8   tier
    ) {
        uint256 tokenId = walletToTokenId[wallet];
        if (tokenId == 0) return (false, 0, 0);
        PassportData storage p = passports[tokenId];
        trusted = p.active && p.riskIndex < 60;
        score   = p.fusedScore;
        tier    = p.tier;
    }

    // ─── Legacy / Backward-Compat API ───────────────────────────────

    /**
     * @notice All ClawTrust passports are soulbound by design.
     */
    function soulbound(uint256 tokenId) external view returns (bool) {
        if (tokenIdToWallet[tokenId] == address(0)) revert PassportNotFound();
        return true;
    }

    function hasMinted(address wallet) external view returns (bool) {
        return walletToTokenId[wallet] != 0;
    }

    function isAgentIdAvailable(string calldata agentId) external view returns (bool) {
        return !handleUsed[agentId];
    }

    /**
     * @notice Passports are soulbound — handles cannot be updated after minting.
     *         Always reverts with TokenIsSoulbound.
     */
    function updateAgentId(uint256, string calldata) external pure {
        revert TokenIsSoulbound();
    }

    function getCardInfo(uint256 tokenId) external view returns (
        address cardOwner,
        string  memory agentId,
        bool    isSoulboundFlag,
        bool    transferable
    ) {
        cardOwner       = ownerOf(tokenId);
        agentId         = passports[tokenId].handle;
        isSoulboundFlag = true;
        transferable    = false;
    }

    function authorizedMinters(address account) external view returns (bool) {
        return hasRole(MINTER_ROLE, account);
    }

    function authorizeMinter(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidAddress();
        _grantRole(MINTER_ROLE, account);
    }

    function revokeMinter(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, account);
    }

    function lockAsSoulbound(uint256) external pure {
        // All passports are already unconditionally soulbound — this is a no-op
    }

    // ─── Token URI ──────────────────────────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory custom = passports[tokenId].metadataUri;
        if (bytes(custom).length > 0) return custom;
        return string.concat(
            baseTokenURI,
            "/api/agents/",
            passports[tokenId].handle,
            "/card/metadata"
        );
    }

    // ─── Admin / Pause ──────────────────────────────────────────────

    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function setBaseURI(string calldata newURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bytes(newURI).length == 0) revert InvalidBaseURI();
        baseTokenURI = newURI;
        emit BaseURIUpdated(newURI);
    }

    function deactivatePassport(uint256 tokenId, string calldata reason) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (tokenIdToWallet[tokenId] == address(0)) revert PassportNotFound();
        passports[tokenId].active = false;
        emit PassportDeactivated(tokenId, reason);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    // ─── supportsInterface ──────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return
            interfaceId == type(IERC8004Identity).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
