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
    uint256 public constant DISPUTE_WINDOW = 48 hours;

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
    mapping(bytes32 => uint256) public submittedAt;
    uint256 private _jobCounter;

    // L-06: rate-limit job creation to max 10 jobs per address per hour
    mapping(address => uint256) public lastJobCreatedAt;
    mapping(address => uint256) public jobsThisHour;
    uint256 public constant MAX_JOBS_PER_HOUR = 10;

    address public treasury;

    // ─── Legacy single evaluator (kept for backward-read-compatibility) ───
    address public evaluator;

    // ─── FIX C-01: Multi-evaluator threshold system ───────────────────────
    // Replaces the single-evaluator single point of failure.
    // Any evaluator can call complete() to record an approval.
    // Payout only executes when approvalCount[jobId] >= evaluatorThreshold.
    mapping(address => bool) public evaluators;
    uint256 public evaluatorCount;
    uint256 public evaluatorThreshold; // defaults to 1 for backward compat; set to 2+ for multi-sig
    mapping(bytes32 => mapping(address => bool)) public evaluatorApprovals;
    mapping(bytes32 => uint256) public approvalCount;

    // ─── FIX H-01: Track funds locked in active jobs ──────────────────────
    // Prevents recoverStuckUSDC from draining funds owed to active job participants.
    uint256 public totalLockedBudget;

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
    // L-06: raised when a client exceeds MAX_JOBS_PER_HOUR job creations
    error RateLimitExceeded();

    // ═══════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════

    event EvaluatorUpdated(address indexed oldEvaluator, address indexed newEvaluator);
    event EvaluatorAdded(address indexed evaluator);
    event EvaluatorRemoved(address indexed evaluator);
    event EvaluatorThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event JobApproved(bytes32 indexed jobId, address indexed evaluator, uint256 approvalCount);
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

        // Primary evaluator (legacy address + multi-sig mapping)
        evaluator = _evaluator;
        evaluators[_evaluator] = true;
        evaluatorCount = 1;

        // FIX C-01: Default threshold=2 for quorum enforcement out of the box.
        // The deployer (owner) is added as a second evaluator so the contract is
        // immediately operable (threshold can be met without a separate addEvaluator call).
        // Owner can be removed from evaluators after adding external evaluators.
        if (_evaluator != msg.sender) {
            evaluators[msg.sender] = true;
            evaluatorCount = 2;
        }
        evaluatorThreshold = 2;
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
        if (bytes(description).length > 1000) revert InvalidAmount();

        // L-06: enforce max 10 jobs per address per hour to prevent storage spam
        if (block.timestamp >= lastJobCreatedAt[msg.sender] + 1 hours) {
            // new hour window — reset counter
            jobsThisHour[msg.sender] = 0;
            lastJobCreatedAt[msg.sender] = block.timestamp;
        }
        jobsThisHour[msg.sender]++;
        if (jobsThisHour[msg.sender] > MAX_JOBS_PER_HOUR) revert RateLimitExceeded();

        _jobCounter++;
        // abi.encode (not encodePacked) prevents hash-collision between different-length inputs
        jobId = keccak256(abi.encode(msg.sender, _jobCounter, block.timestamp));

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
    // slither-disable-next-line reentrancy-no-eth
    // Protected by `nonReentrant`. safeTransferFrom is on the trusted USDC token.
    // State update (job.status = Funded) happens after the transfer — CEI is intentionally
    // inverted here because the transfer must succeed before we mark the job as funded.
    function fund(bytes32 jobId) external override nonReentrant whenNotPaused {
        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        if (job.status != JobStatus.Open) revert InvalidStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (block.timestamp >= job.expiredAt) revert JobAlreadyExpired();

        usdc.safeTransferFrom(msg.sender, address(this), job.budget);
        job.status = JobStatus.Funded;

        // FIX H-01: track locked budget so recoverStuckUSDC cannot drain active jobs
        totalLockedBudget += job.budget;

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
        job.status = JobStatus.Assigned;

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
        if (job.status != JobStatus.Assigned) revert InvalidStatus();
        if (msg.sender != job.provider) revert Unauthorized();
        if (block.timestamp >= job.expiredAt) revert JobAlreadyExpired();
        // M-05: reject empty deliverableHash — providers must submit a real proof
        if (deliverableHash == bytes32(0)) revert InvalidAmount();

        job.deliverableHash = deliverableHash;
        job.status = JobStatus.Submitted;
        submittedAt[jobId] = block.timestamp;

        emit JobSubmitted(jobId, msg.sender, deliverableHash);
    }

    /**
     * @notice Record an evaluator's approval for a submitted job.
     *
     * FIX C-01 (primary path): Evaluators call this function to add their approval on-chain.
     * Payout fires automatically when `approvalCount[jobId] >= evaluatorThreshold`.
     * Each evaluator can approve at most once per job (idempotent; duplicate calls are no-ops).
     * If the threshold is not met, the function succeeds (approval persisted) but no USDC moves.
     *
     * @param jobId  The job to approve
     * @param reason bytes32 attestation reason (e.g. keccak of "SWARM_APPROVED")
     */
    // slither-disable-next-line reentrancy-benign
    // Protected by `nonReentrant`. USDC transfer happens inside _executeCompletion, after state
    // is fully updated (job.status = Completed, totalLockedBudget adjusted).
    function approveCompletion(bytes32 jobId, bytes32 reason) external nonReentrant whenNotPaused {
        _recordApprovalAndMaybeComplete(jobId, reason);
    }

    /**
     * @notice ERC-8183 backward-compatible alias for approveCompletion.
     *         Delegates fully to approveCompletion semantics (quorum-gated, no owner bypass).
     *
     * @param jobId  The job to complete
     * @param reason bytes32 attestation reason
     */
    function complete(bytes32 jobId, bytes32 reason) external override nonReentrant whenNotPaused {
        _recordApprovalAndMaybeComplete(jobId, reason);
    }

    // ─── Internal: approval accumulation + conditional payout ──────

    function _recordApprovalAndMaybeComplete(bytes32 jobId, bytes32 reason) internal {
        if (!evaluators[msg.sender]) revert Unauthorized();

        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        if (job.status != JobStatus.Submitted) revert InvalidStatus();

        // Record approval — idempotent: each evaluator can approve at most once per job
        if (!evaluatorApprovals[jobId][msg.sender]) {
            evaluatorApprovals[jobId][msg.sender] = true;
            approvalCount[jobId]++;
            emit JobApproved(jobId, msg.sender, approvalCount[jobId]);
        }

        // Execute payout only when quorum is reached; otherwise return (approval persisted)
        if (approvalCount[jobId] >= evaluatorThreshold) {
            _executeCompletion(jobId, reason, job);
        }
    }

    // slither-disable-next-line reentrancy-benign
    // Called from nonReentrant functions only. State updated before transfers.
    function _executeCompletion(bytes32 jobId, bytes32 reason, Job storage job) internal {
        job.status = JobStatus.Completed;
        job.outcomeReason = reason;

        // FIX H-01: release from locked budget accounting
        totalLockedBudget -= job.budget;

        uint256 fee = (job.budget * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 payout = job.budget - fee;

        if (fee > 0) {
            usdc.safeTransfer(treasury, fee);
            emit FeesCollected(jobId, fee);
        }
        usdc.safeTransfer(job.provider, payout);

        totalJobsCompleted++;
        totalVolumeUSDC += job.budget;

        emit JobCompleted(jobId, job.provider, reason);
    }

    /**
     * @notice Mark a submitted job as rejected. Refunds USDC to client.
     * @dev Only a registered evaluator or the owner can call this.
     * @param jobId The job to reject
     * @param reason bytes32 attestation reason (e.g. keccak of "SWARM_REJECTED")
     */
    function reject(bytes32 jobId, bytes32 reason) external override nonReentrant whenNotPaused {
        if (!evaluators[msg.sender] && msg.sender != owner()) revert Unauthorized();

        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound();
        if (job.status != JobStatus.Submitted) revert InvalidStatus();

        job.status = JobStatus.Rejected;
        job.outcomeReason = reason;

        // FIX H-01: release from locked budget accounting
        totalLockedBudget -= job.budget;

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

        bool wasFunded = (job.status == JobStatus.Funded);
        job.status = JobStatus.Cancelled;

        if (wasFunded) {
            // FIX H-01: release from locked budget accounting
            totalLockedBudget -= job.budget;
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
        if (job.status != JobStatus.Open && job.status != JobStatus.Funded && job.status != JobStatus.Assigned && job.status != JobStatus.Submitted)
            revert InvalidStatus();

        bool hadFunds = job.status == JobStatus.Funded || job.status == JobStatus.Assigned || job.status == JobStatus.Submitted;
        job.status = JobStatus.Expired;

        if (hadFunds) {
            // FIX H-01: release from locked budget accounting
            totalLockedBudget -= job.budget;
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

    /**
     * @notice Set the primary evaluator (legacy address) and add it to the evaluators mapping.
     * @dev Kept for backward compatibility. Use addEvaluator / removeEvaluator for multi-sig.
     */
    function setEvaluator(address _evaluator) external onlyOwner {
        if (_evaluator == address(0)) revert InvalidAddress();
        emit EvaluatorUpdated(evaluator, _evaluator);
        evaluator = _evaluator;
        // Also register in the multi-evaluator mapping if not already present
        if (!evaluators[_evaluator]) {
            evaluators[_evaluator] = true;
            evaluatorCount++;
            emit EvaluatorAdded(_evaluator);
        }
    }

    /**
     * @notice Add an evaluator to the multi-sig set.
     * @dev Use setEvaluatorThreshold to require quorum after adding.
     */
    function addEvaluator(address _evaluator) external onlyOwner {
        if (_evaluator == address(0)) revert InvalidAddress();
        if (!evaluators[_evaluator]) {
            evaluators[_evaluator] = true;
            evaluatorCount++;
            emit EvaluatorAdded(_evaluator);
        }
    }

    /**
     * @notice Remove an evaluator from the multi-sig set.
     * @dev evaluatorThreshold is NOT automatically lowered — call setEvaluatorThreshold if needed.
     */
    function removeEvaluator(address _evaluator) external onlyOwner {
        if (evaluators[_evaluator]) {
            evaluators[_evaluator] = false;
            if (evaluatorCount > 0) evaluatorCount--;
            emit EvaluatorRemoved(_evaluator);
        }
    }

    /**
     * @notice Set the minimum number of evaluator approvals required to complete a job.
     * @param _threshold Must be >= 1 and <= evaluatorCount.
     */
    function setEvaluatorThreshold(uint256 _threshold) external onlyOwner {
        if (_threshold == 0 || _threshold > evaluatorCount) revert InvalidAmount();
        uint256 old = evaluatorThreshold;
        evaluatorThreshold = _threshold;
        emit EvaluatorThresholdUpdated(old, _threshold);
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
        if (token == address(usdc)) revert Unauthorized();
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Recover USDC that is genuinely stuck (not owed to active jobs).
     *
     * FIX H-01: Only recovers the surplus above totalLockedBudget.
     * This prevents draining funds that belong to active job participants.
     *
     * @param to       Recipient address
     * @param amount   Amount to recover (must be <= balance - totalLockedBudget)
     */
    function recoverStuckUSDC(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = usdc.balanceOf(address(this));
        uint256 recoverable = balance > totalLockedBudget ? balance - totalLockedBudget : 0;
        if (amount > recoverable) revert InvalidAmount();
        usdc.safeTransfer(to, amount);
    }
}
