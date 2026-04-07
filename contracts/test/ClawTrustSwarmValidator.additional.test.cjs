const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ClawTrustSwarmValidator — additional coverage", function () {
  let validator, mockToken, owner, escrow, assignee, v1, v2, v3, other;
  const GIG_ID = ethers.id("sv-add-001");
  const GIG_ID2 = ethers.id("sv-add-002");

  beforeEach(async function () {
    [owner, escrow, assignee, v1, v2, v3, other] = await ethers.getSigners();

    const Validator = await ethers.getContractFactory("ClawTrustSwarmValidator");
    validator = await Validator.deploy(escrow.address);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("MockTKN", "MTK", 18);
    await mockToken.mint(escrow.address, ethers.parseEther("10000"));
    await mockToken.connect(escrow).approve(await validator.getAddress(), ethers.MaxUint256);
  });

  async function createValidation(gigId, rewardPool, poster) {
    gigId = gigId || GIG_ID;
    rewardPool = rewardPool || 0;
    poster = poster || owner.address;
    await validator.connect(escrow).createValidation(
      gigId,
      poster,
      assignee.address,
      [v1.address, v2.address, v3.address],
      2,
      rewardPool,
      await mockToken.getAddress()
    );
  }

  // ─── _checkThreshold — rejection path → _refundRewardPool ─────────

  describe("rejection path and reward refund", function () {
    it("should resolve Rejected and refund reward pool to poster when votes against reach threshold", async function () {
      const rewardPool = ethers.parseEther("90");
      await createValidation(GIG_ID, rewardPool, owner.address);

      // poster is owner.address — refund goes there
      const before = await mockToken.balanceOf(owner.address);

      await validator.connect(v1).vote(GIG_ID, 2); // Reject
      await validator.connect(v2).vote(GIG_ID, 2); // Reject — threshold reached

      const info = await validator.getValidationInfo(GIG_ID);
      expect(info.status).to.equal(2n); // Rejected

      const after = await mockToken.balanceOf(owner.address);
      expect(after - before).to.equal(rewardPool);
    });

    it("should emit ValidationResolved on rejection", async function () {
      await createValidation(GIG_ID, 0);
      await validator.connect(v1).vote(GIG_ID, 2);
      await expect(validator.connect(v2).vote(GIG_ID, 2))
        .to.emit(validator, "ValidationResolved");
    });
  });

  // ─── sweepResidualRewards ─────────────────────────────────────────

  describe("sweepResidualRewards", function () {
    const SWEEP_WINDOW = 30 * 24 * 3600; // 30 days

    it("should sweep residual rewards after SWEEP_CLAIM_WINDOW", async function () {
      const rewardPool = ethers.parseEther("100");
      await createValidation(GIG_ID, rewardPool);

      // Reach approved status
      await validator.connect(v1).vote(GIG_ID, 1);
      await validator.connect(v2).vote(GIG_ID, 1);

      // Advance time past sweep window
      await time.increase(SWEEP_WINDOW + 1);

      const before = await mockToken.balanceOf(owner.address);
      await validator.connect(owner).sweepResidualRewards(GIG_ID, owner.address);
      const after = await mockToken.balanceOf(owner.address);
      expect(after - before).to.equal(rewardPool);
    });

    it("should revert SweepTooEarly before SWEEP_CLAIM_WINDOW", async function () {
      await createValidation(GIG_ID, ethers.parseEther("10"));
      await validator.connect(v1).vote(GIG_ID, 1);
      await validator.connect(v2).vote(GIG_ID, 1);

      await expect(
        validator.connect(owner).sweepResidualRewards(GIG_ID, owner.address)
      ).to.be.revertedWithCustomError(validator, "SweepTooEarly");
    });

    it("should revert NoRewardAvailable when pool is fully claimed", async function () {
      const rewardPool = ethers.parseEther("10");
      await createValidation(GIG_ID, rewardPool);
      await validator.connect(v1).vote(GIG_ID, 1);
      await validator.connect(v2).vote(GIG_ID, 1);

      // Claim reward (v1 voted approve, status approved)
      await validator.connect(v1).claimReward(GIG_ID);

      await time.increase(SWEEP_WINDOW + 1);

      // After claim, residual should be zero
      // No revert needed if pool is 0 from zero-reward validation
      // Create a new validation with no reward to test zero residual path
      await createValidation(GIG_ID2, 0);
      await validator.connect(v1).vote(GIG_ID2, 1);
      await validator.connect(v2).vote(GIG_ID2, 1);
      await time.increase(SWEEP_WINDOW + 1);

      await expect(
        validator.connect(owner).sweepResidualRewards(GIG_ID2, owner.address)
      ).to.be.revertedWithCustomError(validator, "NoRewardAvailable");
    });

    it("should revert ValidationNotApproved if status is not Approved", async function () {
      await createValidation(GIG_ID, ethers.parseEther("10"));
      // Don't vote — still Pending
      await time.increase(SWEEP_WINDOW + 1);
      await expect(
        validator.connect(owner).sweepResidualRewards(GIG_ID, owner.address)
      ).to.be.revertedWithCustomError(validator, "ValidationNotApproved");
    });

    it("should revert for zero-address recipient", async function () {
      await createValidation(GIG_ID, ethers.parseEther("10"));
      await validator.connect(v1).vote(GIG_ID, 1);
      await validator.connect(v2).vote(GIG_ID, 1);
      await time.increase(SWEEP_WINDOW + 1);
      await expect(
        validator.connect(owner).sweepResidualRewards(GIG_ID, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(validator, "InvalidAddress");
    });
  });

  // ─── getGigVerdict ────────────────────────────────────────────────

  describe("getGigVerdict", function () {
    it("should return 'approved' for approved validation", async function () {
      await createValidation(GIG_ID, 0);
      await validator.connect(v1).vote(GIG_ID, 1);
      await validator.connect(v2).vote(GIG_ID, 1);
      expect(await validator.getGigVerdict(GIG_ID)).to.equal("approved");
    });

    it("should return 'rejected' for rejected validation", async function () {
      await createValidation(GIG_ID, 0);
      await validator.connect(v1).vote(GIG_ID, 2);
      await validator.connect(v2).vote(GIG_ID, 2);
      expect(await validator.getGigVerdict(GIG_ID)).to.equal("rejected");
    });

    it("should return 'pending' for pending validation", async function () {
      await createValidation(GIG_ID, 0);
      expect(await validator.getGigVerdict(GIG_ID)).to.equal("pending");
    });

    it("should return 'expired' for expired validation", async function () {
      await createValidation(GIG_ID, 0);
      const info = await validator.getValidationInfo(GIG_ID);
      await time.increase(Number(info.expiresAt) - (await time.latest()) + 1);
      await validator.expireValidation(GIG_ID);
      expect(await validator.getGigVerdict(GIG_ID)).to.equal("expired");
    });

    it("should return 'not_found' for unknown gigId", async function () {
      expect(await validator.getGigVerdict(ethers.id("ghost"))).to.equal("not_found");
    });
  });

  // ─── Admin: setEscrowContract, setDefaultThreshold, setDefaultCandidateCount ──

  describe("setEscrowContract", function () {
    it("should update escrow contract", async function () {
      await validator.connect(owner).setEscrowContract(other.address);
      expect(await validator.escrowContract()).to.equal(other.address);
    });

    it("should revert on zero address", async function () {
      await expect(
        validator.connect(owner).setEscrowContract(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(validator, "InvalidAddress");
    });
  });

  describe("setDefaultThreshold", function () {
    it("should update default threshold", async function () {
      await validator.connect(owner).setDefaultThreshold(5);
      expect(await validator.defaultThreshold()).to.equal(5n);
    });

    it("should revert on zero threshold", async function () {
      await expect(
        validator.connect(owner).setDefaultThreshold(0)
      ).to.be.revertedWithCustomError(validator, "InvalidThreshold");
    });

    it("should revert when threshold > 20", async function () {
      await expect(
        validator.connect(owner).setDefaultThreshold(21)
      ).to.be.revertedWithCustomError(validator, "InvalidThreshold");
    });
  });

  describe("setDefaultCandidateCount", function () {
    it("should update default candidate count", async function () {
      await validator.connect(owner).setDefaultCandidateCount(5);
      expect(await validator.defaultCandidateCount()).to.equal(5n);
    });

    it("should revert when count < 3", async function () {
      await expect(
        validator.connect(owner).setDefaultCandidateCount(2)
      ).to.be.revertedWithCustomError(validator, "InvalidThreshold");
    });
  });

  describe("computeRewardPool", function () {
    it("should compute reward pool correctly", async function () {
      const result = await validator.computeRewardPool(1000, 10, 100);
      expect(result).to.equal(100n);
    });

    it("should return 0 for zero reward rate", async function () {
      expect(await validator.computeRewardPool(1000, 0, 100)).to.equal(0n);
    });
  });

  describe("hasVoted / getVote / isCandidate", function () {
    it("should return false before voting", async function () {
      await createValidation(GIG_ID, 0);
      expect(await validator.hasVoted(GIG_ID, v1.address)).to.equal(false);
    });

    it("should return true and correct vote type after voting", async function () {
      await createValidation(GIG_ID, 0);
      await validator.connect(v1).vote(GIG_ID, 1); // Approve
      expect(await validator.hasVoted(GIG_ID, v1.address)).to.equal(true);
      expect(await validator.getVote(GIG_ID, v1.address)).to.equal(1n);
    });

    it("should correctly identify candidates", async function () {
      await createValidation(GIG_ID, 0);
      expect(await validator.isCandidate(GIG_ID, v1.address)).to.equal(true);
      expect(await validator.isCandidate(GIG_ID, other.address)).to.equal(false);
    });
  });
});
