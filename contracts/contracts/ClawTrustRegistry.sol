// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title ClawTrustRegistry
 * @notice Multi-TLD agent domain system for ClawTrust.
 *         Supports .claw, .shell, .pinch TLDs as ERC-721 NFTs.
 *         (.molt is handled separately by ClawCardNFT)
 *
 *         Access model:
 *         - .claw  — reputation-gated (Gold Shell+) OR 50 USDC/yr
 *         - .shell — reputation-gated (Silver Molt+) OR 100 USDC/yr
 *         - .pinch — reputation-gated (Bronze Pinch+) OR 25 USDC/yr
 *
 *         Only REGISTRAR_ROLE (backend oracle) can call register().
 *         The backend enforces reputation/payment checks before calling.
 */
contract ClawTrustRegistry is ERC721, AccessControl, Pausable, ReentrancyGuard {
    using Strings for uint256;

    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant PAUSER_ROLE    = keccak256("PAUSER_ROLE");

    uint256 private _nextTokenId = 1;
    uint256 public constant MAX_SUPPLY = 10_000_000;

    string public constant TLD_CLAW  = ".claw";
    string public constant TLD_SHELL = ".shell";
    string public constant TLD_PINCH = ".pinch";

    struct DomainRecord {
        string  name;           // e.g. "jarvis"
        string  tld;            // e.g. ".claw"
        address owner;
        uint256 registeredAt;
        uint256 expiresAt;      // registeredAt + 365 days
        uint256 pricePaid;      // USDC amount (in wei, 6 decimals); 0 = reputation-gated free
        bool    active;
    }

    mapping(uint256 => DomainRecord)   public domains;
    mapping(bytes32  => uint256)       public domainToTokenId;  // keccak256(name+tld) → tokenId
    mapping(bytes32  => bool)          public domainTaken;
    mapping(address  => uint256[])     public ownerTokenIds;

    event DomainRegistered(
        uint256 indexed tokenId,
        string  name,
        string  tld,
        string  fullDomain,
        address indexed owner,
        uint256 pricePaid,
        uint256 expiresAt
    );
    event DomainExpired(uint256 indexed tokenId, string fullDomain);

    error InvalidTLD();
    error InvalidName();
    error DomainAlreadyTaken();
    error DomainNotFound();
    error ReservedName();
    error MaxSupplyReached();

    bytes32 private constant _RESERVED_ADMIN   = keccak256("admin");
    bytes32 private constant _RESERVED_API     = keccak256("api");
    bytes32 private constant _RESERVED_APP     = keccak256("app");
    bytes32 private constant _RESERVED_TRUST   = keccak256("trust");
    bytes32 private constant _RESERVED_CLAW    = keccak256("claw");
    bytes32 private constant _RESERVED_MOLT    = keccak256("molt");
    bytes32 private constant _RESERVED_SHELL   = keccak256("shell");
    bytes32 private constant _RESERVED_PINCH   = keccak256("pinch");
    bytes32 private constant _RESERVED_ROOT    = keccak256("root");
    bytes32 private constant _RESERVED_CLAWTRUST = keccak256("clawtrust");

    constructor() ERC721("ClawTrust Name Service", "CLNS") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE,     msg.sender);
        _grantRole(PAUSER_ROLE,        msg.sender);
    }

    function register(
        string calldata name,
        string calldata tld,
        address         owner,
        uint256         pricePaid
    ) external whenNotPaused nonReentrant onlyRole(REGISTRAR_ROLE) returns (uint256 tokenId) {
        if (_nextTokenId > MAX_SUPPLY) revert MaxSupplyReached();

        _validateTLD(tld);
        _validateName(name);

        bytes32 domainKey = _domainKey(name, tld);
        if (domainTaken[domainKey]) revert DomainAlreadyTaken();

        tokenId = _nextTokenId++;
        uint256 expiresAt = block.timestamp + 365 days;

        domains[tokenId] = DomainRecord({
            name:         name,
            tld:          tld,
            owner:        owner,
            registeredAt: block.timestamp,
            expiresAt:    expiresAt,
            pricePaid:    pricePaid,
            active:       true
        });

        domainToTokenId[domainKey] = tokenId;
        domainTaken[domainKey]     = true;
        ownerTokenIds[owner].push(tokenId);

        _safeMint(owner, tokenId);

        string memory full = string(abi.encodePacked(name, tld));
        emit DomainRegistered(tokenId, name, tld, full, owner, pricePaid, expiresAt);
    }

    function resolve(string calldata name, string calldata tld) external view returns (address owner) {
        bytes32 key = _domainKey(name, tld);
        if (!domainTaken[key]) revert DomainNotFound();
        uint256 tokenId = domainToTokenId[key];
        DomainRecord storage d = domains[tokenId];
        if (block.timestamp > d.expiresAt) return address(0);
        return d.owner;
    }

    function isAvailable(string calldata name, string calldata tld) external view returns (bool) {
        bytes32 key = _domainKey(name, tld);
        if (!domainTaken[key]) return true;
        uint256 tokenId = domainToTokenId[key];
        return block.timestamp > domains[tokenId].expiresAt;
    }

    function getDomain(uint256 tokenId) external view returns (DomainRecord memory) {
        if (domains[tokenId].registeredAt == 0) revert DomainNotFound();
        return domains[tokenId];
    }

    function getOwnerTokenIds(address owner) external view returns (uint256[] memory) {
        return ownerTokenIds[owner];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (domains[tokenId].registeredAt == 0) revert DomainNotFound();
        DomainRecord storage d = domains[tokenId];
        string memory full = string(abi.encodePacked(d.name, d.tld));
        string memory json = string(abi.encodePacked(
            '{"name":"', full,
            '","description":"ClawTrust Name Service domain: ', full,
            '","attributes":[',
            '{"trait_type":"TLD","value":"', d.tld, '"},',
            '{"trait_type":"Name","value":"', d.name, '"},',
            '{"trait_type":"Registered","value":', d.registeredAt.toString(), '},',
            '{"trait_type":"Expires","value":', d.expiresAt.toString(), '},',
            '{"trait_type":"Price Paid (USDC micro)","value":', d.pricePaid.toString(),
            '}]}'
        ));
        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _validateTLD(string calldata tld) internal pure {
        bytes memory b = bytes(tld);
        bool ok = (
            keccak256(b) == keccak256(bytes(TLD_CLAW))  ||
            keccak256(b) == keccak256(bytes(TLD_SHELL)) ||
            keccak256(b) == keccak256(bytes(TLD_PINCH))
        );
        if (!ok) revert InvalidTLD();
    }

    function _validateName(string calldata name) internal pure {
        bytes memory b = bytes(name);
        if (b.length < 3 || b.length > 32) revert InvalidName();

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool valid = (c >= 0x61 && c <= 0x7A) || // a-z
                         (c >= 0x30 && c <= 0x39) || // 0-9
                         (c == 0x2D && i > 0 && i < b.length - 1); // hyphen (not at start/end)
            if (!valid) revert InvalidName();
        }

        bytes32 nameHash = keccak256(b);
        if (
            nameHash == _RESERVED_ADMIN     ||
            nameHash == _RESERVED_API       ||
            nameHash == _RESERVED_APP       ||
            nameHash == _RESERVED_TRUST     ||
            nameHash == _RESERVED_CLAW      ||
            nameHash == _RESERVED_MOLT      ||
            nameHash == _RESERVED_SHELL     ||
            nameHash == _RESERVED_PINCH     ||
            nameHash == _RESERVED_ROOT      ||
            nameHash == _RESERVED_CLAWTRUST
        ) revert ReservedName();
    }

    function _domainKey(string calldata name, string calldata tld) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(name, tld));
    }

    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            domains[tokenId].owner = to;
            ownerTokenIds[to].push(tokenId);
        }
        return super._update(to, tokenId, auth);
    }
}
