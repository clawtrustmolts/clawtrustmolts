// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC8183 {
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Cancelled,
        Expired
    }

    event JobCreated(bytes32 indexed jobId, address indexed client, uint256 budget, uint256 expiredAt);
    event JobFunded(bytes32 indexed jobId, address indexed client, uint256 amount);
    event JobProviderAssigned(bytes32 indexed jobId, address indexed provider);
    event JobSubmitted(bytes32 indexed jobId, address indexed provider, bytes32 deliverableHash);
    event JobCompleted(bytes32 indexed jobId, address indexed provider, bytes32 reason);
    event JobRejected(bytes32 indexed jobId, address indexed client, bytes32 reason);
    event JobCancelled(bytes32 indexed jobId, address indexed client);
    event JobExpired(bytes32 indexed jobId);

    function createJob(
        string calldata description,
        uint256 budget,
        uint256 durationSeconds
    ) external returns (bytes32 jobId);

    function fund(bytes32 jobId) external;

    function assignProvider(bytes32 jobId, address provider) external;

    function submit(bytes32 jobId, bytes32 deliverableHash) external;

    function complete(bytes32 jobId, bytes32 reason) external;

    function reject(bytes32 jobId, bytes32 reason) external;

    function cancel(bytes32 jobId) external;

    function expireJob(bytes32 jobId) external;

    function getJobStatus(bytes32 jobId) external view returns (JobStatus);
}
