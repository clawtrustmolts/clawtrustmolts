const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawTrustAC", function () {
  let clawTrustAC;
  let mockUSDC;
  let mockClawCard;
  let owner, client, provider, evaluator, treasury, other, evaluator2;

  const ONE_DAY = 86400;
  const BUDGET = ethers.parseUnits("100", 6);

  beforeEach(async function () {
    [owner, client, provider, evaluator, treasury, other, evaluator2] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();

    const MockClawCard = await ethers.deployContract("MockClawCard");
    mockClawCard = MockClawCard;

    const MockRepAdapter = await ethers.deployContract("MockRepAdapter");
    const MockBond = await ethers.deployContract("MockBond");

    const ClawTrustAC = await ethers.getContractFactory("ClawTrustAC");
    clawTrustAC = await ClawTrustAC.deploy(
      await mockClawCard.getAddress(),
      await MockRepAdapter.getAddress(),
      await MockBond.getAddress(),
      await mockUSDC.getAddress(),
      treasury.address,
      evaluator.address
    );
    await clawTrustAC.waitForDeployment();

    await mockUSDC.mint(client.address, ethers.parseUnits("10000", 6));
    await mockUSDC.mint(provider.address, ethers.parseUnits("1000", 6));

    await mockUSDC.connect(client).approve(await clawTrustAC.getAddress(), ethers.MaxUint256);

    await mockClawCard.setRegistered(provider.address, true);
  });

  describe("createJob", function () {
    it("creates a job with correct parameters", async function () {
      const tx = await clawTrustAC.connect(client).createJob("Build a DeFi dashboard", BUDGET, ONE_DAY);
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => {
        try {
          const parsed = clawTrustAC.interface.parseLog(log);
          return parsed.name === "JobCreated";
        } catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const parsed = clawTrustAC.interface.parseLog(event);
      const jobId = parsed.args[0];

      const job = await clawTrustAC.getJob(jobId);
      expect(job.client).to.equal(client.address);
      expect(job.budget).to.equal(BUDGET);
      expect(job.status).to.equal(0);
    });

    it("rejects budget below minimum", async function () {
      await expect(
        clawTrustAC.connect(client).createJob("test", 100n, ONE_DAY)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidAmount");
    });

    it("rejects duration below minimum", async function () {
      await expect(
        clawTrustAC.connect(client).createJob("test", BUDGET, 100)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidDuration");
    });
  });

  async function createAndFundJob() {
    const tx = await clawTrustAC.connect(client).createJob("Build a DeFi dashboard", BUDGET, ONE_DAY);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => {
      try { return clawTrustAC.interface.parseLog(log).name === "JobCreated"; } catch { return false; }
    });
    const jobId = clawTrustAC.interface.parseLog(event).args[0];

    await clawTrustAC.connect(client).fund(jobId);
    return jobId;
  }

  describe("fund", function () {
    it("transfers USDC and sets status to Funded", async function () {
      const tx = await clawTrustAC.connect(client).createJob("Test gig", BUDGET, ONE_DAY);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try { return clawTrustAC.interface.parseLog(log).name === "JobCreated"; } catch { return false; }
      });
      const jobId = clawTrustAC.interface.parseLog(event).args[0];

      const contractAddr = await clawTrustAC.getAddress();
      const balBefore = await mockUSDC.balanceOf(contractAddr);
      await clawTrustAC.connect(client).fund(jobId);
      const balAfter = await mockUSDC.balanceOf(contractAddr);

      expect(balAfter - balBefore).to.equal(BUDGET);
      const job = await clawTrustAC.getJob(jobId);
      expect(job.status).to.equal(1);
    });

    it("increments totalLockedBudget on fund (H-01)", async function () {
      const tx = await clawTrustAC.connect(client).createJob("Test gig", BUDGET, ONE_DAY);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try { return clawTrustAC.interface.parseLog(log).name === "JobCreated"; } catch { return false; }
      });
      const jobId = clawTrustAC.interface.parseLog(event).args[0];

      const lockedBefore = await clawTrustAC.totalLockedBudget();
      await clawTrustAC.connect(client).fund(jobId);
      const lockedAfter = await clawTrustAC.totalLockedBudget();
      expect(lockedAfter - lockedBefore).to.equal(BUDGET);
    });

    it("reverts if not client", async function () {
      const tx = await clawTrustAC.connect(client).createJob("Test", BUDGET, ONE_DAY);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try { return clawTrustAC.interface.parseLog(log).name === "JobCreated"; } catch { return false; }
      });
      const jobId = clawTrustAC.interface.parseLog(event).args[0];

      await expect(
        clawTrustAC.connect(other).fund(jobId)
      ).to.be.revertedWithCustomError(clawTrustAC, "Unauthorized");
    });
  });

  describe("assignProvider", function () {
    it("assigns a registered provider and sets Assigned status", async function () {
      const jobId = await createAndFundJob();
      await clawTrustAC.connect(client).assignProvider(jobId, provider.address);
      const job = await clawTrustAC.getJob(jobId);
      expect(job.provider).to.equal(provider.address);
      expect(job.status).to.equal(2);
    });

    it("rejects unregistered provider", async function () {
      const jobId = await createAndFundJob();
      await expect(
        clawTrustAC.connect(client).assignProvider(jobId, other.address)
      ).to.be.revertedWithCustomError(clawTrustAC, "ProviderNotRegistered");
    });

    it("rejects self-dealing", async function () {
      const jobId = await createAndFundJob();
      await mockClawCard.setRegistered(client.address, true);
      await expect(
        clawTrustAC.connect(client).assignProvider(jobId, client.address)
      ).to.be.revertedWithCustomError(clawTrustAC, "SelfDealingNotAllowed");
    });
  });

  async function createFundAssignJob() {
    const jobId = await createAndFundJob();
    await clawTrustAC.connect(client).assignProvider(jobId, provider.address);
    return jobId;
  }

  describe("submit", function () {
    it("provider can submit work", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://QmDeliverable"));
      await clawTrustAC.connect(provider).submit(jobId, hash);
      const job = await clawTrustAC.getJob(jobId);
      expect(job.status).to.equal(3);
      expect(job.deliverableHash).to.equal(hash);
    });

    it("reverts if not provider", async function () {
      const jobId = await createFundAssignJob();
      await expect(
        clawTrustAC.connect(other).submit(jobId, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(clawTrustAC, "Unauthorized");
    });
  });

  describe("complete (happy path)", function () {
    it("evaluator completes job and pays provider", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);

      const providerBalBefore = await mockUSDC.balanceOf(provider.address);
      const treasuryBalBefore = await mockUSDC.balanceOf(treasury.address);

      const reason = ethers.keccak256(ethers.toUtf8Bytes("SWARM_APPROVED"));
      await clawTrustAC.connect(evaluator).complete(jobId, reason);

      const fee = (BUDGET * 250n) / 10000n;
      const payout = BUDGET - fee;

      expect(await mockUSDC.balanceOf(provider.address)).to.equal(providerBalBefore + payout);
      expect(await mockUSDC.balanceOf(treasury.address)).to.equal(treasuryBalBefore + fee);

      const job = await clawTrustAC.getJob(jobId);
      expect(job.status).to.equal(4);
      expect(job.outcomeReason).to.equal(reason);

      const stats = await clawTrustAC.getStats();
      expect(stats[1]).to.equal(1n);
    });

    it("reverts if not evaluator", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);
      await expect(
        clawTrustAC.connect(other).complete(jobId, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(clawTrustAC, "Unauthorized");
    });

    it("decrements totalLockedBudget on complete (H-01)", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);

      const lockedBefore = await clawTrustAC.totalLockedBudget();
      await clawTrustAC.connect(evaluator).complete(jobId, ethers.ZeroHash);
      const lockedAfter = await clawTrustAC.totalLockedBudget();
      expect(lockedBefore - lockedAfter).to.equal(BUDGET);
    });

    it("C-01: adminComplete allows owner to force-complete without quorum (explicit escape hatch)", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);
      // adminComplete is the explicit owner bypass (complete() no longer has owner bypass)
      await clawTrustAC.connect(owner).adminComplete(jobId, ethers.ZeroHash);
      const job = await clawTrustAC.getJob(jobId);
      expect(job.status).to.equal(4);
    });

    it("C-01: non-owner cannot call adminComplete", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);
      await expect(
        clawTrustAC.connect(evaluator).adminComplete(jobId, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(clawTrustAC, "OwnableUnauthorizedAccount");
    });

    it("C-01: evaluator is tracked in evaluators mapping", async function () {
      expect(await clawTrustAC.evaluators(evaluator.address)).to.equal(true);
      expect(await clawTrustAC.evaluatorCount()).to.equal(1n);
      expect(await clawTrustAC.evaluatorThreshold()).to.equal(1n);
    });

    it("C-01: approveCompletion registers approval same as complete()", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);

      // approveCompletion is the primary C-01 path; complete() is a backward-compat alias
      await clawTrustAC.connect(evaluator).approveCompletion(jobId, ethers.ZeroHash);
      // With threshold=1, approval immediately fires payout
      const job = await clawTrustAC.getJob(jobId);
      expect(job.status).to.equal(4);
      expect(await clawTrustAC.approvalCount(jobId)).to.equal(1n);
    });

    it("C-01: duplicate approveCompletion call on completed job reverts (InvalidStatus)", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);

      await clawTrustAC.connect(evaluator).approveCompletion(jobId, ethers.ZeroHash);
      // Job is now Completed — second call should revert InvalidStatus
      await expect(
        clawTrustAC.connect(evaluator).approveCompletion(jobId, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidStatus");
    });
  });

  describe("C-01: multi-evaluator threshold system", function () {
    it("addEvaluator registers a new evaluator", async function () {
      await clawTrustAC.connect(owner).addEvaluator(evaluator2.address);
      expect(await clawTrustAC.evaluators(evaluator2.address)).to.equal(true);
      expect(await clawTrustAC.evaluatorCount()).to.equal(2n);
    });

    it("removeEvaluator deregisters an evaluator", async function () {
      await clawTrustAC.connect(owner).addEvaluator(evaluator2.address);
      await clawTrustAC.connect(owner).removeEvaluator(evaluator2.address);
      expect(await clawTrustAC.evaluators(evaluator2.address)).to.equal(false);
      expect(await clawTrustAC.evaluatorCount()).to.equal(1n);
    });

    it("setEvaluatorThreshold requires count >= threshold", async function () {
      // Only 1 evaluator; threshold > 1 should revert (InvalidAmount)
      await expect(
        clawTrustAC.connect(owner).setEvaluatorThreshold(2)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidAmount");
    });

    it("setEvaluatorThreshold works after adding second evaluator", async function () {
      await clawTrustAC.connect(owner).addEvaluator(evaluator2.address);
      await clawTrustAC.connect(owner).setEvaluatorThreshold(2);
      expect(await clawTrustAC.evaluatorThreshold()).to.equal(2n);
    });

    it("threshold=2: first evaluator records approval (tx succeeds), second evaluator completes job", async function () {
      await clawTrustAC.connect(owner).addEvaluator(evaluator2.address);
      await mockUSDC.connect(evaluator2).approve(await clawTrustAC.getAddress(), ethers.MaxUint256);
      await clawTrustAC.connect(owner).setEvaluatorThreshold(2);

      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);

      // First evaluator approves — tx succeeds (approval persisted), but threshold not met yet
      // (early return, no revert — state is written so approval count is preserved)
      await clawTrustAC.connect(evaluator).complete(jobId, ethers.ZeroHash);

      // approval was recorded
      expect(await clawTrustAC.approvalCount(jobId)).to.equal(1n);
      // Job is still in Submitted status (payout not triggered)
      const job1 = await clawTrustAC.getJob(jobId);
      expect(job1.status).to.equal(3); // Submitted

      // Second evaluator approves — threshold met, job completes
      await clawTrustAC.connect(evaluator2).complete(jobId, ethers.ZeroHash);
      const job2 = await clawTrustAC.getJob(jobId);
      expect(job2.status).to.equal(4); // Completed
      expect(await clawTrustAC.approvalCount(jobId)).to.equal(2n);
    });

    it("non-evaluator non-owner cannot complete before dispute window", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);
      await expect(
        clawTrustAC.connect(other).complete(jobId, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(clawTrustAC, "Unauthorized");
    });
  });

  describe("H-01: recoverStuckUSDC", function () {
    it("owner can recover surplus USDC (not locked budget)", async function () {
      // Send USDC directly to the contract (simulating stuck funds)
      await mockUSDC.mint(owner.address, ethers.parseUnits("50", 6));
      await mockUSDC.connect(owner).transfer(await clawTrustAC.getAddress(), ethers.parseUnits("50", 6));

      const ownerBefore = await mockUSDC.balanceOf(owner.address);
      await clawTrustAC.connect(owner).recoverStuckUSDC(owner.address, ethers.parseUnits("50", 6));
      const ownerAfter = await mockUSDC.balanceOf(owner.address);
      expect(ownerAfter - ownerBefore).to.equal(ethers.parseUnits("50", 6));
    });

    it("recoverStuckUSDC cannot drain active job funds (H-01)", async function () {
      const jobId = await createAndFundJob(); // BUDGET locked in contract
      // totalLockedBudget = BUDGET; contract balance = BUDGET; recoverable = 0
      await expect(
        clawTrustAC.connect(owner).recoverStuckUSDC(owner.address, 1n)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidAmount");
    });

    it("recoverStuckUSDC allows recovery of surplus when jobs are active", async function () {
      // Fund a job (budget locked)
      const jobId = await createAndFundJob();

      // Mint extra USDC directly to contract (simulating stuck surplus)
      const surplus = ethers.parseUnits("20", 6);
      await mockUSDC.mint(await clawTrustAC.getAddress(), surplus);

      // Should be able to recover the surplus only
      const ownerBefore = await mockUSDC.balanceOf(owner.address);
      await clawTrustAC.connect(owner).recoverStuckUSDC(owner.address, surplus);
      const ownerAfter = await mockUSDC.balanceOf(owner.address);
      expect(ownerAfter - ownerBefore).to.equal(surplus);

      // But cannot recover more (the locked budget is untouchable)
      await expect(
        clawTrustAC.connect(owner).recoverStuckUSDC(owner.address, 1n)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidAmount");
    });

    it("non-owner cannot call recoverStuckUSDC", async function () {
      await expect(
        clawTrustAC.connect(other).recoverStuckUSDC(other.address, 1n)
      ).to.be.reverted;
    });
  });

  describe("reject", function () {
    it("evaluator rejects job and refunds client", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);

      const clientBalBefore = await mockUSDC.balanceOf(client.address);
      const reason = ethers.keccak256(ethers.toUtf8Bytes("SWARM_REJECTED"));
      await clawTrustAC.connect(evaluator).reject(jobId, reason);

      expect(await mockUSDC.balanceOf(client.address)).to.equal(clientBalBefore + BUDGET);
      const job = await clawTrustAC.getJob(jobId);
      expect(job.status).to.equal(5);
    });

    it("reject decrements totalLockedBudget (H-01)", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);

      const lockedBefore = await clawTrustAC.totalLockedBudget();
      await clawTrustAC.connect(evaluator).reject(jobId, ethers.ZeroHash);
      const lockedAfter = await clawTrustAC.totalLockedBudget();
      expect(lockedBefore - lockedAfter).to.equal(BUDGET);
    });
  });

  describe("cancel", function () {
    it("client can cancel funded job and get refund", async function () {
      const jobId = await createAndFundJob();
      const clientBalBefore = await mockUSDC.balanceOf(client.address);
      await clawTrustAC.connect(client).cancel(jobId);
      expect(await mockUSDC.balanceOf(client.address)).to.equal(clientBalBefore + BUDGET);
      const job = await clawTrustAC.getJob(jobId);
      expect(job.status).to.equal(6);
    });

    it("cancel decrements totalLockedBudget (H-01)", async function () {
      const jobId = await createAndFundJob();
      const lockedBefore = await clawTrustAC.totalLockedBudget();
      await clawTrustAC.connect(client).cancel(jobId);
      const lockedAfter = await clawTrustAC.totalLockedBudget();
      expect(lockedBefore - lockedAfter).to.equal(BUDGET);
    });

    it("client can cancel open job without refund", async function () {
      const tx = await clawTrustAC.connect(client).createJob("Test", BUDGET, ONE_DAY);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try { return clawTrustAC.interface.parseLog(log).name === "JobCreated"; } catch { return false; }
      });
      const jobId = clawTrustAC.interface.parseLog(event).args[0];

      const clientBalBefore = await mockUSDC.balanceOf(client.address);
      await clawTrustAC.connect(client).cancel(jobId);
      expect(await mockUSDC.balanceOf(client.address)).to.equal(clientBalBefore);
    });

    it("cannot cancel assigned job", async function () {
      const jobId = await createFundAssignJob();
      await expect(
        clawTrustAC.connect(client).cancel(jobId)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidStatus");
    });

    it("cannot cancel submitted job", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);
      await expect(
        clawTrustAC.connect(client).cancel(jobId)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidStatus");
    });
  });

  describe("expireJob", function () {
    it("refunds client after expiry", async function () {
      const tx = await clawTrustAC.connect(client).createJob("Test", BUDGET, ONE_DAY);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try { return clawTrustAC.interface.parseLog(log).name === "JobCreated"; } catch { return false; }
      });
      const jobId = clawTrustAC.interface.parseLog(event).args[0];
      await clawTrustAC.connect(client).fund(jobId);

      await ethers.provider.send("evm_increaseTime", [ONE_DAY + 1]);
      await ethers.provider.send("evm_mine");

      const clientBalBefore = await mockUSDC.balanceOf(client.address);
      await clawTrustAC.connect(other).expireJob(jobId);
      expect(await mockUSDC.balanceOf(client.address)).to.equal(clientBalBefore + BUDGET);
    });

    it("expireJob decrements totalLockedBudget (H-01)", async function () {
      const tx = await clawTrustAC.connect(client).createJob("Test", BUDGET, ONE_DAY);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try { return clawTrustAC.interface.parseLog(log).name === "JobCreated"; } catch { return false; }
      });
      const jobId = clawTrustAC.interface.parseLog(event).args[0];
      await clawTrustAC.connect(client).fund(jobId);

      await ethers.provider.send("evm_increaseTime", [ONE_DAY + 1]);
      await ethers.provider.send("evm_mine");

      const lockedBefore = await clawTrustAC.totalLockedBudget();
      await clawTrustAC.connect(other).expireJob(jobId);
      const lockedAfter = await clawTrustAC.totalLockedBudget();
      expect(lockedBefore - lockedAfter).to.equal(BUDGET);
    });

    it("reverts if not yet expired", async function () {
      const jobId = await createAndFundJob();
      await expect(
        clawTrustAC.expireJob(jobId)
      ).to.be.revertedWithCustomError(clawTrustAC, "JobNotExpired");
    });
  });

  describe("getStats", function () {
    it("tracks volume and completion rate", async function () {
      const jobId = await createFundAssignJob();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      await clawTrustAC.connect(provider).submit(jobId, hash);
      await clawTrustAC.connect(evaluator).complete(jobId, ethers.ZeroHash);

      const stats = await clawTrustAC.getStats();
      expect(stats[0]).to.equal(1n);
      expect(stats[1]).to.equal(1n);
      expect(stats[2]).to.equal(BUDGET);
      expect(stats[3]).to.equal(100n);
    });
  });

  describe("admin", function () {
    it("owner can set evaluator", async function () {
      await clawTrustAC.connect(owner).setEvaluator(other.address);
      expect(await clawTrustAC.evaluator()).to.equal(other.address);
    });

    it("setEvaluator also adds to evaluators mapping", async function () {
      await clawTrustAC.connect(owner).setEvaluator(other.address);
      expect(await clawTrustAC.evaluators(other.address)).to.equal(true);
    });

    it("non-owner cannot set evaluator", async function () {
      await expect(
        clawTrustAC.connect(other).setEvaluator(other.address)
      ).to.be.reverted;
    });

    it("owner can pause and unpause", async function () {
      await clawTrustAC.connect(owner).pause();
      await expect(
        clawTrustAC.connect(client).createJob("test", BUDGET, ONE_DAY)
      ).to.be.revertedWithCustomError(clawTrustAC, "EnforcedPause");
      await clawTrustAC.connect(owner).unpause();
    });
  });
});
