// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./interfaces/IERC8004Identity.sol";

/**
 * @title ClawCardNFT
 * @notice ERC-721 Soulbound identity card for ClawTrust agents.
 *         Implements IERC8004Identity — one card per wallet, non-transferable by default.
 *         The `.molt` handle is stored on-chain as the agent's identity.
 */
contract ClawCardNFT is ERC721, Ownable, IERC8004Identity {
    using Strings for uint256;

    uint256 private _nextTokenId;
    string public baseTokenURI;
    uint256 public constant MAX_SUPPLY = 1_000_000;

    struct TokenData {
        string handle;
        string metadataUri;
        string[] skills;
        uint256 registeredAt;
        bool soulbound;
    }

    mapping(uint256 => TokenData) internal _tokens;
    mapping(address => uint256) public walletToToken;
    mapping(address => bool) public hasMinted;
    mapping(string => bool) public handleUsed;
    mapping(string => uint256) public handleToToken;
    mapping(address => bool) public authorizedMinters;

    bool public transfersEnabled = true;

    // ERC-8004 events
    event IdentityRegistered(uint256 indexed tokenId, address indexed owner, string handle);
    event IdentityUpdated(uint256 indexed tokenId, string field, string value);

    // Card lifecycle events
    event CardBurned(address indexed wallet, uint256 indexed tokenId, string handle);
    event SoulboundLocked(uint256 indexed tokenId);
    event BaseURIUpdated(string newBaseURI);
    event TransfersToggled(bool enabled);
    event MinterAuthorized(address indexed minter);
    event MinterRevoked(address indexed minter);

    error AlreadyMinted();
    error InvalidHandle();
    error HandleInUse();
    error NotTokenOwner();
    error TokenIsSoulbound();
    error TransfersDisabled();
    error MaxSupplyReached();
    error InvalidBaseURI();
    error InvalidAddress();
    error NotAuthorizedMinter();

    modifier onlyTokenOwner(uint256 tokenId) {
        if(ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        _;
    }

    modifier onlyMinter() {
        if(!authorizedMinters[msg.sender]) revert NotAuthorizedMinter();
        _;
    }

    constructor(string memory _baseTokenURI) ERC721("ClawTrust Card", "CLAW") Ownable(msg.sender) {
        if(bytes(_baseTokenURI).length == 0) revert InvalidBaseURI();
        baseTokenURI = _baseTokenURI;
        _nextTokenId = 1;
        authorizedMinters[msg.sender] = true;
        emit MinterAuthorized(msg.sender);
    }

    // ─── ERC-8004 Identity Interface ────────────────────────────────

    /**
     * @notice Register a new agent identity (ERC-8004).
     *         Caller must be an authorized minter (backend wallet).
     *         Mints to msg.sender.
     */
    function registerIdentity(
        string calldata handle,
        string calldata metadataUri,
        string[] calldata skills
    ) external override onlyMinter returns (uint256 tokenId) {
        return _mintCard(msg.sender, handle, metadataUri, skills, true);
    }

    /**
     * @notice Get full agent identity metadata (ERC-8004).
     */
    function getIdentity(uint256 tokenId) external view override returns (AgentMetadata memory) {
        _requireOwned(tokenId);
        TokenData storage t = _tokens[tokenId];
        return AgentMetadata({
            handle: t.handle,
            metadataUri: t.metadataUri,
            skills: t.skills,
            registeredAt: t.registeredAt
        });
    }

    /**
     * @notice Look up identity by handle (ERC-8004).
     */
    function getIdentityByHandle(string calldata handle) external view override returns (
        uint256 tokenId,
        AgentMetadata memory metadata
    ) {
        if(!handleUsed[handle]) revert InvalidHandle();
        tokenId = handleToToken[handle];
        TokenData storage t = _tokens[tokenId];
        metadata = AgentMetadata({
            handle: t.handle,
            metadataUri: t.metadataUri,
            skills: t.skills,
            registeredAt: t.registeredAt
        });
    }

    /**
     * @notice Update metadata URI for a token (ERC-8004).
     *         Only the token owner can update.
     */
    function updateMetadata(uint256 tokenId, string calldata newUri) external override onlyTokenOwner(tokenId) {
        if(bytes(newUri).length == 0) revert InvalidBaseURI();
        _tokens[tokenId].metadataUri = newUri;
        emit IdentityUpdated(tokenId, "metadataUri", newUri);
    }

    /**
     * @notice Get the owner of an identity token (ERC-8004).
     */
    function ownerOfIdentity(uint256 tokenId) external view override returns (address) {
        return ownerOf(tokenId);
    }

    /**
     * @notice Check if an address has a registered identity (ERC-8004).
     */
    function isRegistered(address agent) external view override returns (bool) {
        return hasMinted[agent];
    }

    // ─── Mint ───────────────────────────────────────────────────────

    /**
     * @notice Mint a ClawCard to msg.sender. Restricted to authorized minters.
     *         makeSoulbound: if true, card is immediately non-transferable.
     */
    function mint(string calldata handle, bool makeSoulbound) external onlyMinter {
        _mintCard(msg.sender, handle, "", new string[](0), makeSoulbound);
    }

    /**
     * @notice Admin mint to any address. Owner only.
     */
    function adminMint(
        address to,
        string calldata handle,
        bool makeSoulbound
    ) external onlyOwner {
        _mintCard(to, handle, "", new string[](0), makeSoulbound);
    }

    /**
     * @notice Admin mint with full ERC-8004 metadata. Owner only.
     */
    function adminMintFull(
        address to,
        string calldata handle,
        string calldata metadataUri,
        string[] calldata skills,
        bool makeSoulbound
    ) external onlyOwner {
        _mintCard(to, handle, metadataUri, skills, makeSoulbound);
    }

    function _mintCard(
        address to,
        string calldata handle,
        string memory metadataUri,
        string[] memory skills,
        bool makeSoulbound
    ) internal returns (uint256) {
        if(hasMinted[to]) revert AlreadyMinted();
        if(bytes(handle).length == 0) revert InvalidHandle();
        if(handleUsed[handle]) revert HandleInUse();
        if(_nextTokenId > MAX_SUPPLY) revert MaxSupplyReached();

        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        _tokens[tokenId] = TokenData({
            handle: handle,
            metadataUri: metadataUri,
            skills: skills,
            registeredAt: block.timestamp,
            soulbound: makeSoulbound
        });

        walletToToken[to] = tokenId;
        hasMinted[to] = true;
        handleUsed[handle] = true;
        handleToToken[handle] = tokenId;

        emit IdentityRegistered(tokenId, to, handle);
        return tokenId;
    }

    // ─── Burn ───────────────────────────────────────────────────────

    function burn(uint256 tokenId) external onlyTokenOwner(tokenId) {
        address tokenOwner = ownerOf(tokenId);
        string memory handle = _tokens[tokenId].handle;

        delete walletToToken[tokenOwner];
        delete hasMinted[tokenOwner];
        delete handleUsed[handle];
        delete handleToToken[handle];
        delete _tokens[tokenId];

        _burn(tokenId);

        emit CardBurned(tokenOwner, tokenId, handle);
    }

    // ─── Soulbound ──────────────────────────────────────────────────

    function lockAsSoulbound(uint256 tokenId) external onlyTokenOwner(tokenId) {
        if(_tokens[tokenId].soulbound) return;
        _approve(address(0), tokenId, msg.sender);
        _tokens[tokenId].soulbound = true;
        emit SoulboundLocked(tokenId);
    }

    // ─── Handle Update ──────────────────────────────────────────────

    function updateHandle(uint256 tokenId, string calldata newHandle) external onlyTokenOwner(tokenId) {
        if(_tokens[tokenId].soulbound) revert TokenIsSoulbound();
        if(bytes(newHandle).length == 0) revert InvalidHandle();
        if(handleUsed[newHandle]) revert HandleInUse();

        string memory oldHandle = _tokens[tokenId].handle;
        delete handleUsed[oldHandle];
        delete handleToToken[oldHandle];

        _tokens[tokenId].handle = newHandle;
        handleUsed[newHandle] = true;
        handleToToken[newHandle] = tokenId;

        emit IdentityUpdated(tokenId, "handle", newHandle);
    }

    // ─── ERC-721 Overrides ──────────────────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory customUri = _tokens[tokenId].metadataUri;
        if(bytes(customUri).length > 0) return customUri;

        return string.concat(
            baseTokenURI,
            "/api/agents/",
            _tokens[tokenId].handle,
            "/card/metadata"
        );
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);

        if (from != address(0) && to != address(0)) {
            if(_tokens[tokenId].soulbound) revert TokenIsSoulbound();
            if(!transfersEnabled) revert TransfersDisabled();
            if(hasMinted[to]) revert AlreadyMinted();

            delete walletToToken[from];
            delete hasMinted[from];

            walletToToken[to] = tokenId;
            hasMinted[to] = true;
        }

        return super._update(to, tokenId, auth);
    }

    function approve(address to, uint256 tokenId) public override {
        if(_tokens[tokenId].soulbound) revert TokenIsSoulbound();
        super.approve(to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public override {
        if(approved) {
            uint256 tokenId = walletToToken[msg.sender];
            if(tokenId != 0 && _tokens[tokenId].soulbound) revert TokenIsSoulbound();
        }
        super.setApprovalForAll(operator, approved);
    }

    // ─── Admin ──────────────────────────────────────────────────────

    function authorizeMinter(address minter) external onlyOwner {
        if(minter == address(0)) revert InvalidAddress();
        authorizedMinters[minter] = true;
        emit MinterAuthorized(minter);
    }

    function revokeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = false;
        emit MinterRevoked(minter);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        if(bytes(newBaseURI).length == 0) revert InvalidBaseURI();
        baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function setTransfersEnabled(bool enabled) external onlyOwner {
        transfersEnabled = enabled;
        emit TransfersToggled(enabled);
    }

    // ─── Views ──────────────────────────────────────────────────────

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function isSoulbound(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return _tokens[tokenId].soulbound;
    }

    function getTokenByHandle(string calldata handle) external view returns (uint256) {
        if(!handleUsed[handle]) revert InvalidHandle();
        return handleToToken[handle];
    }

    function isHandleAvailable(string calldata handle) external view returns (bool) {
        return !handleUsed[handle];
    }

    function getCardInfo(uint256 tokenId) external view returns (
        address cardOwner,
        string memory handle,
        bool isSoulboundFlag,
        bool transferable
    ) {
        cardOwner = ownerOf(tokenId);
        handle = _tokens[tokenId].handle;
        isSoulboundFlag = _tokens[tokenId].soulbound;
        transferable = !isSoulboundFlag && transfersEnabled;
    }
}
