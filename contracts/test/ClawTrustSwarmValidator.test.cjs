const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawTrustSwarmValidator", function () {
  let validator, mockToken, escrow, owner, assignee, v1, v2, v3, v4, other;
  const GIG_ID = ethers.id("swarm-gig-001");
  const GIG_ID_2 = ethers.id("swarm-gig-002");

  beforeEach(async function () {
    [owner, escrow, assignee, v1, v2, v3, v4, other] = await ethers.getSigners();

    const Validator = await ethers.getContractFactory("ClawTrustSwarmValidator");
    validator = await Validator.deploy(escrow.address);
    await validator.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock", "MCK", 18);
    await mockToken.waitForDeployment();
  });

  async function createBasicValidation(gigId) {
    gigId = gigId || GIG_ID;
    await validator.connect(escrow).createValidation(
      gigId, assignee.address, [v1.address, v2.address, v3.address, v4.address], 3, 0, ethers.ZeroAddress
    );
  }

  describe("createValidation", function () {
    it("should create validation", async function () {
      await createBasicValidation();
      expect(await validator.validationExists(GIG_ID)).to.equal(true);
      const info = await validator.getValidationInfo(GIG_ID);
      expect(info.assignee).to.equal(assignee.address);
      expect(info.threshold).to.equal(3);
      expect(info.candidates.length).to.equal(4);
    });

    it("should revert if not escrow", async function () {
      await expect(
        validator.connect(other).createValidation(
          GIG_ID, assignee.address, [v1.address], 1, 0, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(validator, "InvalidAddress");
    });

    it("should revert on duplicate validation", async function () {
      await createBasicValidation();
      await expect(createBasicValidation()).to.be.revertedWithCustomError(validator, "ValidationAlreadyExists");
    });

    it("should revert if assignee is in candidates", async function () {
      await expect(
        validator.connect(escrow).createValidation(
          GIG_ID, assignee.address, [v1.address, assignee.address], 2, 0, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(validator, "AssigneeCannotValidate");
    });

    it("should revert on duplicate candidate", async function () {
      await expect(
        validator.connect(escrow).createValidation(
          GIG_ID, assignee.address, [v1.address, v1.address], 2, 0, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(validator, "DuplicateCandidate");
    });

    it("should revert on zero threshold", async function () {
      await expect(
        validator.connect(escrow).createValidation(
          GIG_ID, assignee.address, [v1.address], 0, 0, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(validator, "InvalidThreshold");
    });

    it("should revert if candidates < threshold", async function () {
      await expect(
        validator.connect(escrow).createValidation(
          GIG_ID, assignee.address, [v1.address], 5, 0, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(validator, "InsufficientCandidates");
    });
  });

  describe("vote", function () {
    beforeEach(async function () {
      await createBasicValidation();
    });

    it("candidate can vote approve", async function () {
      await validator.connect(v1).vote(GIG_ID, 1);
      expect(await validator.hasVoted(GIG_ID, v1.address)).to.equal(true);
      const info = await validator.getValidationInfo(GIG_ID);
      expect(info.votesFor).to.equal(1);
    });

    it("candidate can vote reject", async function () {
      await validator.connect(v1).vote(GIG_ID, 2);
      const info = await validator.getValidationInfo(GIG_ID);
      expect(info.votesAgainst).to.equal(1);
    });

    it("should revert for non-candidate", async function () {
      await expect(
        validator.connect(other).vote(GIG_ID, 1)
      ).to.be.revertedWithCustomError(validator, "NotCandidate");
    });

    it("should revert for double vote", async function () {
      await validator.connect(v1).vote(GIG_ID, 1);
      await expect(
        validator.connect(v1).vote(GIG_ID, 1)
      ).to.be.revertedWithCustomError(validator, "AlreadyVoted");
    });

    it("assignee cannot vote", async function () {
      await expect(
        validator.connect(assignee).vote(GIG_ID, 1)
      ).to.be.revertedWithCustomError(validator, "NotCandidate");
    });

    it("should resolve on reaching threshold (approve)", async function () {
      await validator.connect(v1).vote(GIG_ID, 1);
      await validator.connect(v2).vote(GIG_ID, 1);
      await validator.connect(v3).vote(GIG_ID, 1);
      const info = await validator.getValidationInfo(GIG_ID);
      expect(info.status).to.equal(1);
    });

    it("should resolve on reaching threshold (reject)", async function () {
      await validator.connect(v1).vote(GIG_ID, 2);
      await validator.connect(v2).vote(GIG_ID, 2);
      await validator.connect(v3).vote(GIG_ID, 2);
      const info = await validator.getValidationInfo(GIG_ID);
      expect(info.status).to.equal(2);
    });

    it("should revert after resolution", async function () {
      await validator.connect(v1).vote(GIG_ID, 1);
      await validator.connect(v2).vote(GIG_ID, 1);
      await validator.connect(v3).vote(GIG_ID, 1);
      await expect(
        validator.connect(v4).vote(GIG_ID, 1)
      ).to.be.revertedWithCustomError(validator, "ValidationAlreadyResolved");
    });
  });

  describe("expiration", function () {
    it("should expire after duration", async function () {
      await createBasicValidation();
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await validator.expireValidation(GIG_ID);
      const info = await validator.getValidationInfo(GIG_ID);
      expect(info.status).to.equal(3);
    });

    it("should revert if not expired yet", async function () {
      await createBasicValidation();
      await expect(
        validator.expireValidation(GIG_ID)
      ).to.be.revertedWithCustomError(validator, "NotExpired");
    });
  });

  describe("reward claiming", function () {
    it("should claim ETH reward after approval", async function () {
      const rewardPool = ethers.parseEther("0.3");
      await validator.connect(escrow).createValidation(
        GIG_ID, assignee.address, [v1.address, v2.address, v3.address], 3, rewardPool, ethers.ZeroAddress,
        { value: rewardPool }
      );
      await validator.connect(v1).vote(GIG_ID, 1);
      await validator.connect(v2).vote(GIG_ID, 1);
      await validator.connect(v3).vote(GIG_ID, 1);

      const before = await ethers.provider.getBalance(v1.address);
      await validator.connect(v1).claimReward(GIG_ID);
      const after = await ethers.provider.getBalance(v1.address);
      expect(after).to.be.gt(before);
    });

    it("should revert if not approved", async function () {
      await createBasicValidation();
      await expect(
        validator.connect(v1).claimReward(GIG_ID)
      ).to.be.revertedWithCustomError(validator, "ValidationNotApproved");
    });

    it("should revert if already claimed", async function () {
      const rewardPool = ethers.parseEther("0.3");
      await validator.connect(escrow).createValidation(
        GIG_ID, assignee.address, [v1.address, v2.address, v3.address], 3, rewardPool, ethers.ZeroAddress,
        { value: rewardPool }
      );
      await validator.connect(v1).vote(GIG_ID, 1);
      await validator.connect(v2).vote(GIG_ID, 1);
      await validator.connect(v3).vote(GIG_ID, 1);
      await validator.connect(v1).claimReward(GIG_ID);
      await expect(
        validator.connect(v1).claimReward(GIG_ID)
      ).to.be.revertedWithCustomError(validator, "RewardAlreadyClaimed");
    });
  });

  describe("aggregateVotes", function () {
    it("should return correct aggregate", async function () {
      await createBasicValidation();
      await validator.connect(v1).vote(GIG_ID, 1);
      await validator.connect(v2).vote(GIG_ID, 2);

      const result = await validator.aggregateVotes(GIG_ID);
      expect(result.votesFor).to.equal(1);
      expect(result.votesAgainst).to.equal(1);
      expect(result.threshold).to.equal(3);
    });
  });

  describe("admin functions", function () {
    it("should update default threshold", async function () {
      await validator.setDefaultThreshold(5);
      expect(await validator.defaultThreshold()).to.equal(5);
    });

    it("should update escrow contract", async function () {
      await validator.setEscrowContract(other.address);
      expect(await validator.escrowContract()).to.equal(other.address);
    });

    it("should revert zero threshold", async function () {
      await expect(
        validator.setDefaultThreshold(0)
      ).to.be.revertedWithCustomError(validator, "InvalidThreshold");
    });
  });
});
