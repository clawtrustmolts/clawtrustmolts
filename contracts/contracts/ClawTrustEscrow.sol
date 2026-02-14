// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ClawTrustEscrow is ReentrancyGuard, Ownable {
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

    address public validationRegistry;
    uint256 public platformFeeRate;
    uint256 public constant FEE_DENOMINATOR = 10000;

    event EscrowCreated(bytes32 indexed gigId, address indexed depositor, uint256 amount, address token);
    event EscrowLocked(bytes32 indexed gigId);
    event EscrowReleased(bytes32 indexed gigId, address indexed payee, uint256 amount);
    event EscrowRefunded(bytes32 indexed gigId, address indexed depositor, uint256 amount);
    event EscrowDisputed(bytes32 indexed gigId);

    constructor(address _validationRegistry, uint256 _platformFeeRate) Ownable(msg.sender) {
        validationRegistry = _validationRegistry;
        platformFeeRate = _platformFeeRate;
    }

    function lockETH(bytes32 gigId, address payee) external payable nonReentrant {
        require(!escrowExists[gigId], "Escrow already exists");
        require(msg.value > 0, "Must send ETH");
        require(payee != address(0), "Invalid payee");

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
        require(!escrowExists[gigId], "Escrow already exists");
        require(amount > 0, "Amount must be > 0");
        require(payee != address(0), "Invalid payee");
        require(token != address(0), "Invalid token");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

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
        require(escrowExists[gigId], "Escrow does not exist");
        require(escrow.status == EscrowStatus.Locked, "Not locked");
        require(msg.sender == owner() || msg.sender == escrow.depositor, "Not authorized");

        escrow.status = EscrowStatus.Released;
        escrow.resolvedAt = block.timestamp;

        uint256 fee = (escrow.amount * platformFeeRate) / FEE_DENOMINATOR;
        uint256 payout = escrow.amount - fee;

        if (escrow.token == address(0)) {
            (bool sent, ) = escrow.payee.call{value: payout}("");
            require(sent, "ETH transfer failed");
            if (fee > 0) {
                (bool feeSent, ) = owner().call{value: fee}("");
                require(feeSent, "Fee transfer failed");
            }
        } else {
            IERC20(escrow.token).transfer(escrow.payee, payout);
            if (fee > 0) {
                IERC20(escrow.token).transfer(owner(), fee);
            }
        }

        emit EscrowReleased(gigId, escrow.payee, payout);
    }

    function refund(bytes32 gigId) external nonReentrant {
        Escrow storage escrow = escrows[gigId];
        require(escrowExists[gigId], "Escrow does not exist");
        require(escrow.status == EscrowStatus.Locked, "Not locked");
        require(msg.sender == owner() || msg.sender == escrow.depositor, "Not authorized");

        escrow.status = EscrowStatus.Refunded;
        escrow.resolvedAt = block.timestamp;

        if (escrow.token == address(0)) {
            (bool sent, ) = escrow.depositor.call{value: escrow.amount}("");
            require(sent, "ETH transfer failed");
        } else {
            IERC20(escrow.token).transfer(escrow.depositor, escrow.amount);
        }

        emit EscrowRefunded(gigId, escrow.depositor, escrow.amount);
    }

    function dispute(bytes32 gigId) external {
        Escrow storage escrow = escrows[gigId];
        require(escrowExists[gigId], "Escrow does not exist");
        require(escrow.status == EscrowStatus.Locked, "Not locked");
        require(msg.sender == escrow.depositor || msg.sender == escrow.payee, "Not party to escrow");

        escrow.status = EscrowStatus.Disputed;
        emit EscrowDisputed(gigId);
    }

    function getEscrow(bytes32 gigId) external view returns (Escrow memory) {
        require(escrowExists[gigId], "Escrow does not exist");
        return escrows[gigId];
    }

    function setValidationRegistry(address _registry) external onlyOwner {
        validationRegistry = _registry;
    }

    function setPlatformFeeRate(uint256 _rate) external onlyOwner {
        require(_rate <= 1000, "Fee too high");
        platformFeeRate = _rate;
    }
}
