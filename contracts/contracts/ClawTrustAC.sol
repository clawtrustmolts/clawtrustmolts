// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IERC8183.sol";
import "./interfaces/IClawTrustContracts.sol";

/**
 * @title ClawTrustAC
 * @author ClawTrust
 * @notice ERC-8183 Agentic Commerce adapter for ClawTrust.
 *
 * This contract exposes a standard ERC-8183 interface for external protocols
 * and AI agent frameworks. It wraps ClawTrust's identity and reputation layer
 * without modifying any existing production contracts.
 *
 * CRITICAL: All existing production contracts are READ-ONLY from this adapter.
 * Custody of USDC for ERC-8183 jobs is held by this contract directly.
 *
 * Production Contracts (Base Sepolia — DO NOT REDEPLOY):
 *   ClawCardNFT:            0xf24e41980ed48576Eb379D2116C1AaD075B342C4
 *   ClawTrustRepAdapter:    0xecc00bbE268Fa4D0330180e0fB445f64d824d818
 *   ClawTrustBond:          0x23a1E1e958C932639906d0650A13283f6E60132c
 *   USDC (Base Sepolia):    0x036CbD53842c5426634e7929541eC2318f3dCF7e
 */
contract ClawTrustAC is IERC8183, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════
    // PRODUCTION CONTRACT REFERENCES (READ-ONLY)
    // ═══════════════════════════════════════════════════════════

    IClawCardNFT public immutable clawCard;
    IClawTrustRepAdapter public immutable repAdapter;
    IClawTrustBond public immutable bond;
    IERC20 public immutable usdc;

    // ═══════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════

    uint256 public constant PLATFORM_FEE_BPS = 250;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_BUDGET = 1e4;
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 90 days;

    // ═══════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        string description;
        bytes32 deliverableHash;
        bytes32 outcomeReason;
        uint256 createdAt;
    }

    mapping(bytes32 => Job) public jobs;
    uint256 private _jobCounter;

    address public treasury;
    address public evaluator;

    uint256 public totalJobsCreated;
    uint256 public totalJobsCompleted;
    uint256 public totalVolumeUSDC;

    // ═══════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════

    error JobNotFound();
    error InvalidStatus();
    error Unauthorized();
    error InvalidAmount();
    error InvalidAddress();
    error InvalidDuration();
    error JobNotExpired();
    error JobAlreadyExpired();
    error ProviderNotRegistered();
    error SelfDealingNotAllowed();

    // ═══════════════════════════════════════════════════════════
    // ADDITIONAL EVENTS
    // ═══════════════════════════════════════════════════════════

    event EvaluatorUpdated(address indexed oldEvaluator, address indexed newEvaluator);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event FeesCollected(bytes32 indexed jobId, uint256 amount);

    // ═══════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════

    constructor(
        address _clawCard,
        address _repAdapter,
        address _bond,
        address _usdc,
        address _treasury,
        address _evaluator
    ) Ownable(msg.sender) {
        if (_clawCard == address(0) || _repAdapter == address(0) || _bond == address(0) ||
            _usdc == address(0) || _treasury == address(0) || _evaluator == address(0))
            revert InvalidAddress();

        clawCard = IClawCardNFT(_clawCard);
        repAdapter = IClawTrustRepAdapter(_repAdapter);
        bond = IClawTrustBond(_bond);
        usdc = IERC20(_usdc);
        treasury = _treasury;
        evaluator = _evaluator;
    }

    // ═══════════════════════════════════════════════════════════
    // ERC-8183 INTERFACE IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Create a new job. Anyone can post a job.
     * @param description Human-readable description of the work
     * @param budget USDC amount (6 decimals) to be paid on completion
     * @param durationSeconds How long providers have to complete the work
     * @return jobId The bytes32 job identifier
     */
    function createJob(
        string calldata description,
        uint256 budget,
        uint256 durationSeconds
    ) external override whenNotPaused returns (bytes32 jobId) {
        if (budget < MIN_BUDGET) revert InvalidAmount();
        if (durationSeconds < MIN_DURATION || durationSeconds > MAX_DURATION) revert InvalidDuration();

        _jobCounter++;
        jobId = keccak256(abi.encodePacked(msg.sender, _jobCounter, block.timestamp));

        uint256 expiry = block.timestamp + durationSeconds;

        jobs[jobId] = Job({
            client: msg.sender,
            provider: address(0),
            evaluator: evaluator,
            budget: budget,
            expiredAt: expiry,
            status: JobStatus.Open,
            description: description,
            deliverableHash: bytes32(0),
            outcomeReason: bytes32(0),
            createdAt: block.timestamp
        });

        totalJobsCreated++;

        emit JobCreated(jobId, msg.sender, budget, expiry);
    }

    /**
     * @notice Fund a job by transferring USDC into this contract.
     * @dev Client must approve this contract for `budget` USDC before calling.
     * @param jobId The job to fund
     */
    function fund(bytes32 jobId) external override nonReentrant whenNotPaused {
        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        if (job.status != JobStatus.Open) revert InvalidStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (block.timestamp >= job.expiredAt) revert JobAlreadyExpired();

        usdc.safeTransferFrom(msg.sender, address(this), job.budget);
        job.status = JobStatus.Funded;

        totalVolumeUSDC += job.budget;

        emit JobFunded(jobId, msg.sender, job.budget);
    }

    /**
     * @notice Assign a provider to a funded job. Only the client can assign.
     * @dev Provider must hold a ClawCard NFT (ERC-8004 registered agent).
     * @param jobId The job to assign
     * @param provider The agent wallet address to assign
     */
    function assignProvider(bytes32 jobId, address provider) external override whenNotPaused {
        if (provider == address(0)) revert InvalidAddress();
        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        if (job.status != JobStatus.Funded) revert InvalidStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (provider == job.client) revert SelfDealingNotAllowed();
        if (block.timestamp >= job.expiredAt) revert JobAlreadyExpired();

        if (!clawCard.isRegistered(provider)) revert ProviderNotRegistered();

        job.provider = provider;

        emit JobProviderAssigned(jobId, provider);
    }

    /**
     * @notice Provider submits completed work. Triggers the evaluation phase.
     * @param jobId The job being submitted
     * @param deliverableHash Hash of the deliverable (IPFS CID, proof URL hash, etc.)
     */
    function submit(bytes32 jobId, bytes32 deliverableHash) external override whenNotPaused {
        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        if (job.status != JobStatus.Funded) revert InvalidStatus();
        if (msg.sender != job.provider) revert Unauthorized();
        if (block.timestamp >= job.expiredAt) revert JobAlreadyExpired();

        job.deliverableHash = deliverableHash;
        job.status = JobStatus.Submitted;

        emit JobSubmitted(jobId, msg.sender, deliverableHash);
    }

    /**
     * @notice Mark a submitted job as completed. Releases USDC to provider.
     * @dev Only the evaluator (oracle) can call this. Platform fee deducted.
     * @param jobId The job to complete
     * @param reason bytes32 attestation reason (e.g. keccak of "SWARM_APPROVED")
     */
    function complete(bytes32 jobId, bytes32 reason) external override nonReentrant whenNotPaused {
        if (msg.sender != evaluator && msg.sender != owner()) revert Unauthorized();

        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        if (job.status != JobStatus.Submitted) revert InvalidStatus();

        job.status = JobStatus.Completed;
        job.outcomeReason = reason;

        uint256 fee = (job.budget * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 payout = job.budget - fee;

        if (fee > 0) {
            usdc.safeTransfer(treasury, fee);
            emit FeesCollected(jobId, fee);
        }
        usdc.safeTransfer(job.provider, payout);

        totalJobsCompleted++;

        emit JobCompleted(jobId, job.provider, reason);
    }

    /**
     * @notice Mark a submitted job as rejected. Refunds USDC to client.
     * @dev Only the evaluator (oracle) can call this.
     * @param jobId The job to reject
     * @param reason bytes32 attestation reason (e.g. keccak of "SWARM_REJECTED")
     */
    function reject(bytes32 jobId, bytes32 reason) external override nonReentrant whenNotPaused {
        if (msg.sender != evaluator && msg.sender != owner()) revert Unauthorized();

        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        if (job.status != JobStatus.Submitted) revert InvalidStatus();

        job.status = JobStatus.Rejected;
        job.outcomeReason = reason;

        usdc.safeTransfer(job.client, job.budget);

        emit JobRejected(jobId, job.client, reason);
    }

    /**
     * @notice Cancel a job. Client can cancel if Open or Funded (before submission).
     *         Refunds USDC to client if already funded.
     * @param jobId The job to cancel
     */
    function cancel(bytes32 jobId) external override nonReentrant whenNotPaused {
        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        if (msg.sender != job.client && msg.sender != owner()) revert Unauthorized();
        if (job.status != JobStatus.Open && job.status != JobStatus.Funded) revert InvalidStatus();

        bool wasFunded = job.status == JobStatus.Funded;
        job.status = JobStatus.Cancelled;

        if (wasFunded) {
            usdc.safeTransfer(job.client, job.budget);
        }

        emit JobCancelled(jobId, job.client);
    }

    /**
     * @notice Expire a job that has passed its deadline. Refunds USDC to client.
     * @dev Anyone can call this to clean up expired funded jobs.
     * @param jobId The job to expire
     */
    function expireJob(bytes32 jobId) external override nonReentrant {
        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        if (block.timestamp < job.expiredAt) revert JobNotExpired();
        if (job.status != JobStatus.Open && job.status != JobStatus.Funded && job.status != JobStatus.Submitted)
            revert InvalidStatus();

        bool hadFunds = job.status == JobStatus.Funded || job.status == JobStatus.Submitted;
        job.status = JobStatus.Expired;

        if (hadFunds) {
            usdc.safeTransfer(job.client, job.budget);
        }

        emit JobExpired(jobId);
    }

    /**
     * @notice Get the current status of a job.
     * @param jobId The job to query
     * @return Current JobStatus enum value
     */
    function getJobStatus(bytes32 jobId) external view override returns (JobStatus) {
        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        return job.status;
    }

    // ═══════════════════════════════════════════════════════════
    // READ FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Get full job details.
     */
    function getJob(bytes32 jobId) external view returns (Job memory) {
        if (jobs[jobId].client == address(0)) revert JobNotFound();
        return jobs[jobId];
    }

    /**
     * @notice Get the total number of jobs ever created.
     */
    function jobCount() external view returns (uint256) {
        return _jobCounter;
    }

    /**
     * @notice Check ERC-8004 registration status of a provider wallet.
     */
    function isRegisteredAgent(address wallet) external view returns (bool) {
        return clawCard.isRegistered(wallet);
    }

    /**
     * @notice Get stats for the ERC-8183 adapter.
     */
    function getStats() external view returns (
        uint256 created,
        uint256 completed,
        uint256 volumeUSDC,
        uint256 completionRate
    ) {
        created = totalJobsCreated;
        completed = totalJobsCompleted;
        volumeUSDC = totalVolumeUSDC;
        completionRate = created > 0 ? (completed * 100) / created : 0;
    }

    // ═══════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    function setEvaluator(address _evaluator) external onlyOwner {
        if (_evaluator == address(0)) revert InvalidAddress();
        emit EvaluatorUpdated(evaluator, _evaluator);
        evaluator = _evaluator;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        IERC20(token).safeTransfer(to, amount);
    }
}
