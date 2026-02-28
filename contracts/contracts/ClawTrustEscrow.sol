// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

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
contract ClawTrustEscrow is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    enum EscrowStatus { Pending, Locked, Released, Refunded, Disputed }

    struct Escrow {
        bytes32 gigId;
        address depositor;
        address payee;
        uint256 amount;
        bool isUsdc;
        EscrowStatus status;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => bool) public escrowExists;

    IERC20 public immutable usdc;
    address public immutable validationRegistry;
    address public x402Facilitator;

    uint256 public platformFeeRate;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_RATE = 1000;
    uint256 public constant ESCROW_TIMEOUT = 90 days;
    uint256 public constant MIN_ESCROW_AMOUNT = 1000;

    event EscrowCreated(bytes32 indexed gigId, address indexed depositor, uint256 amount, bool isUsdc);
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
    error TransferFailed();
    error SwarmNotApproved();
    error FeeTooHigh();
    error SelfDealingNotAllowed();
    error BelowMinimumAmount();
    error ValidationExpired();

    constructor(
        address _usdcToken,
        address _validationRegistry,
        uint256 _platformFeeRate
    ) Ownable(msg.sender) {
        if(_usdcToken == address(0)) revert InvalidAddress();
        if(_validationRegistry == address(0)) revert InvalidAddress();
        if(_platformFeeRate > MAX_FEE_RATE) revert FeeTooHigh();

        usdc = IERC20(_usdcToken);
        validationRegistry = _validationRegistry;
        platformFeeRate = _platformFeeRate;
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

    // ─── ETH Escrow ────────────────────────────────────────────────

    /**
     * @notice Lock ETH for a gig.
     */
    function lockETH(bytes32 gigId, address payee) external payable nonReentrant whenNotPaused {
        if(gigId == bytes32(0)) revert InvalidGigId();
        if(escrowExists[gigId]) revert EscrowAlreadyExists();
        if(msg.value == 0) revert InvalidAmount();
        if(msg.value < MIN_ESCROW_AMOUNT) revert BelowMinimumAmount();
        if(payee == address(0)) revert InvalidAddress();
        if(payee == msg.sender) revert SelfDealingNotAllowed();

        _createEscrow(gigId, msg.sender, payee, msg.value, false);
    }

    // ─── Release / Refund ──────────────────────────────────────────

    function release(bytes32 gigId) external nonReentrant whenNotPaused {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(msg.sender != owner() && msg.sender != escrow.depositor) revert Unauthorized();

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

    function dispute(bytes32 gigId) external {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(msg.sender != escrow.depositor && msg.sender != escrow.payee) revert Unauthorized();

        escrow.status = EscrowStatus.Disputed;
        emit EscrowDisputed(gigId);
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
    }

    function _createEscrow(
        bytes32 gigId,
        address depositor,
        address payee,
        uint256 amount,
        bool isUsdc
    ) internal {
        escrows[gigId] = Escrow({
            gigId: gigId,
            depositor: depositor,
            payee: payee,
            amount: amount,
            isUsdc: isUsdc,
            status: EscrowStatus.Locked,
            createdAt: block.timestamp,
            resolvedAt: 0
        });
        escrowExists[gigId] = true;

        emit EscrowCreated(gigId, depositor, amount, isUsdc);
        emit EscrowLocked(gigId);
    }

    function _releaseEscrow(Escrow storage escrow) private {
        escrow.status = EscrowStatus.Released;
        escrow.resolvedAt = block.timestamp;

        uint256 fee = (escrow.amount * platformFeeRate) / FEE_DENOMINATOR;
        uint256 payout = escrow.amount - fee;

        if (escrow.isUsdc) {
            usdc.safeTransfer(escrow.payee, payout);
            if (fee > 0) {
                usdc.safeTransfer(owner(), fee);
            }
        } else {
            (bool sent, ) = escrow.payee.call{value: payout}("");
            if(!sent) revert TransferFailed();
            if (fee > 0) {
                (bool feeSent, ) = owner().call{value: fee}("");
                if(!feeSent) revert TransferFailed();
            }
        }

        emit EscrowReleased(escrow.gigId, escrow.payee, payout, fee);
    }

    function _doRefund(Escrow storage escrow, bytes32 gigId) private {
        escrow.status = EscrowStatus.Refunded;
        escrow.resolvedAt = block.timestamp;

        if (escrow.isUsdc) {
            usdc.safeTransfer(escrow.depositor, escrow.amount);
        } else {
            (bool sent, ) = escrow.depositor.call{value: escrow.amount}("");
            if(!sent) revert TransferFailed();
        }

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

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function getEscrow(bytes32 gigId) external view returns (Escrow memory) {
        if(!escrowExists[gigId]) revert EscrowNotFound();
        return escrows[gigId];
    }
}

interface ISwarmValidator {
    function aggregateVotes(bytes32 gigId) external view returns (
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 threshold,
        uint8 status,
        bool isApproved
    );
}
