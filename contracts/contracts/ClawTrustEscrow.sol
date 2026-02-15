// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ClawTrustEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    enum EscrowStatus { Pending, Locked, Released, Refunded, Disputed }

    struct Escrow {
        bytes32 gigId;
        address depositor;
        address payee;
        uint256 amount;
        address token;
        EscrowStatus status;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => bool) public escrowExists;
    mapping(address => bool) public approvedTokens;

    address public immutable validationRegistry;
    uint256 public platformFeeRate;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_RATE = 1000;
    uint256 public constant ESCROW_TIMEOUT = 90 days;

    event EscrowCreated(bytes32 indexed gigId, address indexed depositor, uint256 amount, address token);
    event EscrowLocked(bytes32 indexed gigId);
    event EscrowReleased(bytes32 indexed gigId, address indexed payee, uint256 amount, uint256 fee);
    event EscrowRefunded(bytes32 indexed gigId, address indexed depositor, uint256 amount);
    event EscrowDisputed(bytes32 indexed gigId);
    event PlatformFeeRateUpdated(uint256 oldRate, uint256 newRate);
    event TokenApprovalUpdated(address indexed token, bool approved);

    error InvalidGigId();
    error EscrowAlreadyExists();
    error InvalidAmount();
    error InvalidAddress();
    error EscrowNotFound();
    error InvalidStatus();
    error Unauthorized();
    error TransferFailed();
    error SwarmNotApproved();
    error FeeTooHigh();
    error TokenNotApproved();

    constructor(address _validationRegistry, uint256 _platformFeeRate) Ownable(msg.sender) {
        if(_validationRegistry == address(0)) revert InvalidAddress();
        if(_platformFeeRate > MAX_FEE_RATE) revert FeeTooHigh();

        validationRegistry = _validationRegistry;
        platformFeeRate = _platformFeeRate;
    }

    function lockETH(bytes32 gigId, address payee) external payable nonReentrant {
        if(gigId == bytes32(0)) revert InvalidGigId();
        if(escrowExists[gigId]) revert EscrowAlreadyExists();
        if(msg.value == 0) revert InvalidAmount();
        if(payee == address(0)) revert InvalidAddress();

        escrows[gigId] = Escrow({
            gigId: gigId,
            depositor: msg.sender,
            payee: payee,
            amount: msg.value,
            token: address(0),
            status: EscrowStatus.Locked,
            createdAt: block.timestamp,
            resolvedAt: 0
        });
        escrowExists[gigId] = true;

        emit EscrowCreated(gigId, msg.sender, msg.value, address(0));
        emit EscrowLocked(gigId);
    }

    function lockERC20(bytes32 gigId, address payee, address token, uint256 amount) external nonReentrant {
        if(gigId == bytes32(0)) revert InvalidGigId();
        if(escrowExists[gigId]) revert EscrowAlreadyExists();
        if(amount == 0) revert InvalidAmount();
        if(payee == address(0) || token == address(0)) revert InvalidAddress();
        if(!approvedTokens[token]) revert TokenNotApproved();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        escrows[gigId] = Escrow({
            gigId: gigId,
            depositor: msg.sender,
            payee: payee,
            amount: amount,
            token: token,
            status: EscrowStatus.Locked,
            createdAt: block.timestamp,
            resolvedAt: 0
        });
        escrowExists[gigId] = true;

        emit EscrowCreated(gigId, msg.sender, amount, token);
        emit EscrowLocked(gigId);
    }

    function release(bytes32 gigId) external nonReentrant {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(msg.sender != owner() && msg.sender != escrow.depositor) revert Unauthorized();

        _releaseEscrow(escrow);
    }

    function refund(bytes32 gigId) external nonReentrant {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(msg.sender != owner() && msg.sender != escrow.depositor) revert Unauthorized();

        escrow.status = EscrowStatus.Refunded;
        escrow.resolvedAt = block.timestamp;

        if (escrow.token == address(0)) {
            (bool sent, ) = escrow.depositor.call{value: escrow.amount}("");
            if(!sent) revert TransferFailed();
        } else {
            IERC20(escrow.token).safeTransfer(escrow.depositor, escrow.amount);
        }

        emit EscrowRefunded(gigId, escrow.depositor, escrow.amount);
    }

    function refundAfterTimeout(bytes32 gigId) external nonReentrant {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(block.timestamp < escrow.createdAt + ESCROW_TIMEOUT) revert Unauthorized();

        escrow.status = EscrowStatus.Refunded;
        escrow.resolvedAt = block.timestamp;

        if (escrow.token == address(0)) {
            (bool sent, ) = escrow.depositor.call{value: escrow.amount}("");
            if(!sent) revert TransferFailed();
        } else {
            IERC20(escrow.token).safeTransfer(escrow.depositor, escrow.amount);
        }

        emit EscrowRefunded(gigId, escrow.depositor, escrow.amount);
    }

    function dispute(bytes32 gigId) external {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(msg.sender != escrow.depositor && msg.sender != escrow.payee) revert Unauthorized();

        escrow.status = EscrowStatus.Disputed;
        emit EscrowDisputed(gigId);
    }

    error ValidationExpired();

    function releaseOnSwarmApproval(bytes32 gigId) external nonReentrant {
        Escrow storage escrow = escrows[gigId];
        if(!escrowExists[gigId]) revert EscrowNotFound();
        if(escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if(msg.sender != escrow.depositor && msg.sender != escrow.payee && msg.sender != owner()) {
            revert Unauthorized();
        }

        (uint256 votesFor, , uint256 threshold, uint8 status, bool isApproved) =
            ISwarmValidator(validationRegistry).aggregateVotes(gigId);

        if(!isApproved || votesFor < threshold) revert SwarmNotApproved();
        if(status == 3) revert ValidationExpired();

        _releaseEscrow(escrow);
    }

    function _releaseEscrow(Escrow storage escrow) private {
        escrow.status = EscrowStatus.Released;
        escrow.resolvedAt = block.timestamp;

        uint256 fee = (escrow.amount * platformFeeRate) / FEE_DENOMINATOR;
        uint256 payout = escrow.amount - fee;

        if (escrow.token == address(0)) {
            (bool sent, ) = escrow.payee.call{value: payout}("");
            if(!sent) revert TransferFailed();
            if (fee > 0) {
                (bool feeSent, ) = owner().call{value: fee}("");
                if(!feeSent) revert TransferFailed();
            }
        } else {
            IERC20(escrow.token).safeTransfer(escrow.payee, payout);
            if (fee > 0) {
                IERC20(escrow.token).safeTransfer(owner(), fee);
            }
        }

        emit EscrowReleased(escrow.gigId, escrow.payee, payout, fee);
    }

    function setPlatformFeeRate(uint256 _rate) external onlyOwner {
        if(_rate > MAX_FEE_RATE) revert FeeTooHigh();
        uint256 oldRate = platformFeeRate;
        platformFeeRate = _rate;
        emit PlatformFeeRateUpdated(oldRate, _rate);
    }

    function setTokenApproval(address token, bool approved) external onlyOwner {
        if(token == address(0)) revert InvalidAddress();
        approvedTokens[token] = approved;
        emit TokenApprovalUpdated(token, approved);
    }

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
