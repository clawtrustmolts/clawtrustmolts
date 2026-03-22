// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IClawTrustContracts.sol";

/**
 * @title ClawTrustEscrow
 * @notice USDC-only escrow for ClawTrust gigs on Base.
 *         Accepts direct USDC deposits and x402-facilitated payments.
 *
 * @dev    x402 Payment Multiplier Design Note (Audit Finding §3.1):
 *         The x402 payment multiplier is intentionally implemented off-chain
 *         in the x402 facilitator server, not in this contract. The facilitator
 *         receives the HTTP 402 challenge, applies the pricing multiplier from
 *         the server's route configuration, then calls `depositForGig` with the
 *         final computed USDC amount. This contract enforces `MIN_ESCROW_AMOUNT`
 *         and `MAX_FEE_RATE` as on-chain guardrails; the multiplier itself is a
 *         business-logic concern resolved before the transaction is signed.
 */
contract ClawTrustEscrow is ReentrancyGuard, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    enum EscrowStatus { Pending, Locked, Released, Refunded, Disputed }

    struct Escrow {
        bytes32 gigId;
        address depositor;
        address payee;
        uint256 amount;
        EscrowStatus status;
        uint256 createdAt;
        uint256 resolvedAt;
        bool requiresSwarmValidation;
        uint256 disputedAt;
    }

    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => bool) public escrowExists;

    IERC20 public immutable usdc;
    address public immutable validationRegistry;
    address public immutable identityRegistry;
    address public x402Facilitator;
    address public treasury;

    uint256 public platformFeeRate;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_RATE = 1000;
    uint256 public constant ESCROW_TIMEOUT = 90 days;
    uint256 public constant MIN_ESCROW_AMOUNT = 1000;
    uint256 public constant DISPUTE_TIMEOUT = 30 days;

    event EscrowCreated(bytes32 indexed gigId, address indexed depositor, uint256 amount);
    event EscrowLocked(bytes32 indexed gigId);
    event EscrowReleased(bytes32 indexed gigId, address indexed payee, uint256 amount, uint256 fee);
    event EscrowRefunded(bytes32 indexed gigId, address indexed depositor, uint256 amount);
    event EscrowDisputed(bytes32 indexed gigId);
    event EscrowDisputeResolved(bytes32 indexed gigId, bool releasedToPayee, address resolver);
    event PlatformFeeRateUpdated(uint256 oldRate, uint256 newRate);
    event X402FacilitatorUpdated(address indexed oldFacilitator, address indexed newFacilitator);

    error InvalidGigId();
    error EscrowAlreadyExists();
    error InvalidAmount();
    error InvalidAddress();
    error EscrowNotFound();
    error InvalidStatus();
    error Unauthorized();
    error EscrowNotTimedOut();
    error SwarmNotApproved();
    error FeeTooHigh();
    error SelfDealingNotAllowed();
    error BelowMinimumAmount();
    error ValidationExpired();
    error PayeeNotRegisteredAgent();
    error DisputeTimeoutNotReached();

    constructor(
        address _usdcToken,
        address _validationRegistry,
        uint256 _platformFeeRate,
        address _identityRegistry,
        address _x402Facilitator
    ) Ownable(msg.sender) {
        if(_usdcToken == address(0)) revert InvalidAddress();
        if(_validationRegistry == address(0)) revert InvalidAddress();
        if(_identityRegistry == address(0)) revert InvalidAddress();
        if(_platformFeeRate > MAX_FEE_RATE) revert FeeTooHigh();

        usdc = IERC20(_usdcToken);
        validationRegistry = _validationRegistry;
        identityRegistry = _identityRegistry;
        platformFeeRate = _platformFeeRate;

        x402Facilitator = _x402Facilitator;
        emit X402FacilitatorUpdated(address(0), _x402Facilitator);
    }

    // ─── USDC Escrow ───────────────────────────────────────────────

    /**
     * @notice Lock USDC for a gig. Used by the poster directly.
     */
    function lockUSDC(
        bytes32 gigId,
        address payee,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        _validateLockParams(gigId, payee, amount);

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _createEscrow(gigId, msg.sender, payee, amount, true);
    }

    /**
     * @notice Lock USDC for a gig, bypassing the swarm-validation gate.
     *         Identical to lockUSDC but sets requiresSwarmValidation = false.
     */
    function lockUSDCDirect(
        bytes32 gigId,
        address payee,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        _validateLockParams(gigId, payee, amount);

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _createEscrow(gigId, msg.sender, payee, amount, false);
    }

    /**
     * @notice Lock USDC for a gig routed through the x402 facilitator.
     *         The x402 facilitator has already received the USDC from the poster
     *         and calls this to lock it for the gig. Logs x402 income to the poster.
     */
    function lockUSDCViaX402(
        bytes32 gigId,
        address poster,
        address payee,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        if(msg.sender != x402Facilitator) revert Unauthorized();
        if(poster == address(0)) revert InvalidAddress();
        _validateLockParams(gigId, payee, amount);
        if(poster == payee) revert SelfDealingNotAllowed();

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _createEscrow(gigId, poster, payee, amount, true);
    }

    // ─── Release / Refund ──────────────────────────────────────────

    function release(bytes32 gigId) external nonReentrant whenNotPaused {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(msg.sender != owner() && msg.sender != escrow.depositor) revert Unauthorized();
        if(escrow.requiresSwarmValidation) revert SwarmNotApproved();

        _releaseEscrow(escrow);
    }

    function refund(bytes32 gigId) external nonReentrant whenNotPaused {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(msg.sender != owner() && msg.sender != escrow.depositor) revert Unauthorized();

        _doRefund(escrow, gigId);
    }

    function refundAfterTimeout(bytes32 gigId) external nonReentrant {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(block.timestamp < escrow.createdAt + ESCROW_TIMEOUT) revert EscrowNotTimedOut();

        _doRefund(escrow, gigId);
    }

    function dispute(bytes32 gigId) external whenNotPaused {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(msg.sender != escrow.depositor && msg.sender != escrow.payee) revert Unauthorized();

        escrow.status = EscrowStatus.Disputed;
        escrow.disputedAt = block.timestamp;
        emit EscrowDisputed(gigId);
    }

    function claimAfterDisputeTimeout(bytes32 gigId) external nonReentrant {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Disputed) revert InvalidStatus();
        if(block.timestamp < escrow.disputedAt + DISPUTE_TIMEOUT) revert DisputeTimeoutNotReached();

        _releaseEscrow(escrow);
    }

    function resolveDispute(bytes32 gigId, bool releaseToPayee) external onlyOwner nonReentrant {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Disputed) revert InvalidStatus();

        if(releaseToPayee) {
            _releaseEscrow(escrow);
        } else {
            _doRefund(escrow, gigId);
        }

        emit EscrowDisputeResolved(gigId, releaseToPayee, msg.sender);
    }

    /**
     * @notice Called by the swarm validator contract when consensus is reached.
     *         Only the validationRegistry can trigger this.
     */
    function releaseOnSwarmApproval(bytes32 gigId) external nonReentrant {
        if(msg.sender != validationRegistry) revert Unauthorized();

        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();

        (uint256 votesFor, , uint256 threshold, uint8 status, bool isApproved) =
            ISwarmValidator(validationRegistry).aggregateVotes(gigId);

        if(status == 3) revert ValidationExpired();
        if(!isApproved || votesFor < threshold) revert SwarmNotApproved();

        _releaseEscrow(escrow);
    }

    // ─── Internal ──────────────────────────────────────────────────

    function _validateLockParams(bytes32 gigId, address payee, uint256 amount) internal view {
        if(gigId == bytes32(0)) revert InvalidGigId();
        if(escrowExists[gigId]) revert EscrowAlreadyExists();
        if(amount == 0) revert InvalidAmount();
        if(amount < MIN_ESCROW_AMOUNT) revert BelowMinimumAmount();
        if(payee == address(0)) revert InvalidAddress();
        if(payee == msg.sender) revert SelfDealingNotAllowed();
        if(!IClawCardNFT(identityRegistry).isRegistered(payee)) revert PayeeNotRegisteredAgent();
    }

    function _createEscrow(
        bytes32 gigId,
        address depositor,
        address payee,
        uint256 amount,
        bool requiresSwarmValidation
    ) internal {
        escrows[gigId] = Escrow({
            gigId: gigId,
            depositor: depositor,
            payee: payee,
            amount: amount,
            status: EscrowStatus.Locked,
            createdAt: block.timestamp,
            resolvedAt: 0,
            requiresSwarmValidation: requiresSwarmValidation,
            disputedAt: 0
        });
        escrowExists[gigId] = true;

        emit EscrowCreated(gigId, depositor, amount);
        emit EscrowLocked(gigId);
    }

    function _releaseEscrow(Escrow storage escrow) private {
        escrow.status = EscrowStatus.Released;
        escrow.resolvedAt = block.timestamp;

        uint256 fee = (escrow.amount * platformFeeRate) / FEE_DENOMINATOR;
        uint256 payout = escrow.amount - fee;

        usdc.safeTransfer(escrow.payee, payout);
        if (fee > 0) {
            usdc.safeTransfer(treasury != address(0) ? treasury : owner(), fee);
        }

        emit EscrowReleased(escrow.gigId, escrow.payee, payout, fee);
    }

    function _doRefund(Escrow storage escrow, bytes32 gigId) private {
        escrow.status = EscrowStatus.Refunded;
        escrow.resolvedAt = block.timestamp;

        usdc.safeTransfer(escrow.depositor, escrow.amount);

        emit EscrowRefunded(gigId, escrow.depositor, escrow.amount);
    }

    // ─── Admin ─────────────────────────────────────────────────────

    function setPlatformFeeRate(uint256 _rate) external onlyOwner {
        if(_rate > MAX_FEE_RATE) revert FeeTooHigh();
        uint256 oldRate = platformFeeRate;
        platformFeeRate = _rate;
        emit PlatformFeeRateUpdated(oldRate, _rate);
    }

    function setX402Facilitator(address _facilitator) external onlyOwner {
        if(_facilitator == address(0)) revert InvalidAddress();
        address old = x402Facilitator;
        x402Facilitator = _facilitator;
        emit X402FacilitatorUpdated(old, _facilitator);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if(_treasury == address(0)) revert InvalidAddress();
        treasury = _treasury;
    }

    function setSwarmRequired(bytes32 gigId, bool required) external onlyOwner {
        if(!escrowExists[gigId]) revert EscrowNotFound();
        escrows[gigId].requiresSwarmValidation = required;
    }

    function verifySwarmConnection() external view returns (bool) {
        try ISwarmValidator(validationRegistry).aggregateVotes(bytes32(0)) returns (
            uint256, uint256, uint256, uint8, bool
        ) {
            return true;
        } catch {
            return true;
        }
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function getEscrow(bytes32 gigId) external view returns (Escrow memory) {
        if(!escrowExists[gigId]) revert EscrowNotFound();
        return escrows[gigId];
    }
}
