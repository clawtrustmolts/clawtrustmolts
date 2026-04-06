const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawTrustBond", function () {
  let bond, mockToken, owner, agent, voter1, voter2, voter3, voter4;
  const GIG_ID = ethers.id("bond-gig-001");
  const GIG_ID_2 = ethers.id("bond-gig-002");
  const DEPOSIT_AMOUNT = ethers.parseUnits("100", 6);
  const LOCK_AMOUNT = ethers.parseUnits("50", 6);

  beforeEach(async function () {
    [owner, agent, voter1, voter2, voter3, voter4] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "MUSDC", 6);
    await mockToken.waitForDeployment();

    const Bond = await ethers.getContractFactory("ClawTrustBond");
    bond = await Bond.deploy(await mockToken.getAddress());
    await bond.waitForDeployment();

    await mockToken.mint(agent.address, ethers.parseUnits("10000", 6));
    await mockToken.connect(agent).approve(await bond.getAddress(), ethers.parseUnits("10000", 6));
    await bond.updatePerformanceScore(agent.address, 80);

    await bond.updatePerformanceScore(voter1.address, 75);
    await bond.updatePerformanceScore(voter2.address, 75);
    await bond.updatePerformanceScore(voter3.address, 75);
    await bond.updatePerformanceScore(voter4.address, 75);
  });

  describe("deposit", function () {
    it("should accept deposit", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      const b = await bond.getBond(agent.address);
      expect(b.totalDeposited).to.equal(DEPOSIT_AMOUNT);
      expect(b.available).to.equal(DEPOSIT_AMOUNT);
    });

    it("should revert below minimum", async function () {
      await expect(
        bond.connect(agent).deposit(ethers.parseUnits("1", 6))
      ).to.be.revertedWithCustomError(bond, "BelowMinDeposit");
    });

    it("should revert when paused", async function () {
      await bond.pause();
      await expect(
        bond.connect(agent).deposit(DEPOSIT_AMOUNT)
      ).to.be.revertedWithCustomError(bond, "EnforcedPause");
    });
  });

  describe("withdraw", function () {
    it("should withdraw available bond", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      const before = await mockToken.balanceOf(agent.address);
      await bond.connect(agent).withdraw(DEPOSIT_AMOUNT);
      const after = await mockToken.balanceOf(agent.address);
      expect(after - before).to.equal(DEPOSIT_AMOUNT);
      const b = await bond.getBond(agent.address);
      expect(b.available).to.equal(0);
    });

    it("should revert on insufficient balance", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await expect(
        bond.connect(agent).withdraw(DEPOSIT_AMOUNT + 1n)
      ).to.be.revertedWithCustomError(bond, "InsufficientBond");
    });

    it("should revert on zero amount", async function () {
      await expect(
        bond.connect(agent).withdraw(0)
      ).to.be.revertedWithCustomError(bond, "ZeroAmount");
    });

    it("should allow withdraw even when paused", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.pause();
      await bond.connect(agent).withdraw(DEPOSIT_AMOUNT);
      const b = await bond.getBond(agent.address);
      expect(b.available).to.equal(0);
    });
  });

  describe("lockBondForGig", function () {
    it("authorized caller can lock bond", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.authorizeCaller(owner.address);
      await bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT);
      const b = await bond.getBond(agent.address);
      expect(b.locked).to.equal(LOCK_AMOUNT);
      expect(b.available).to.equal(DEPOSIT_AMOUNT - LOCK_AMOUNT);
    });

    it("should revert for unauthorized caller", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await expect(
        bond.connect(voter1).lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT)
      ).to.be.revertedWithCustomError(bond, "NotAuthorizedCaller");
    });

    it("should revert for low score", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.updatePerformanceScore(agent.address, 30);
      await bond.authorizeCaller(owner.address);
      await expect(
        bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT)
      ).to.be.revertedWithCustomError(bond, "ScoreTooLow");
    });

    it("should revert for duplicate gig", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.authorizeCaller(owner.address);
      await bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT);
      await expect(
        bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT)
      ).to.be.revertedWithCustomError(bond, "GigAlreadyExists");
    });
  });

  describe("swarmVote + finalize", function () {
    beforeEach(async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.authorizeCaller(owner.address);
      await bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT);
    });

    it("should finalize on approval (3 votes)", async function () {
      await bond.connect(voter1).swarmVote(GIG_ID, true);
      await bond.connect(voter2).swarmVote(GIG_ID, true);
      await bond.connect(voter3).swarmVote(GIG_ID, true);
      const b = await bond.getBond(agent.address);
      expect(b.locked).to.equal(0);
      expect(b.available).to.equal(DEPOSIT_AMOUNT);
    });

    it("should slash on rejection (3 votes)", async function () {
      await bond.connect(voter1).swarmVote(GIG_ID, false);
      await bond.connect(voter2).swarmVote(GIG_ID, false);
      await bond.connect(voter3).swarmVote(GIG_ID, false);
      const b = await bond.getBond(agent.address);
      expect(b.locked).to.equal(0);
      const slashAmount = LOCK_AMOUNT * 2000n / 10000n;
      expect(b.totalDeposited).to.equal(DEPOSIT_AMOUNT - slashAmount);
      expect(b.available).to.equal(DEPOSIT_AMOUNT - slashAmount);
    });

    it("should prevent duplicate voting", async function () {
      await bond.connect(voter1).swarmVote(GIG_ID, true);
      await expect(
        bond.connect(voter1).swarmVote(GIG_ID, true)
      ).to.be.revertedWithCustomError(bond, "AlreadyVoted");
    });

    it("should prevent agent self-voting", async function () {
      await expect(
        bond.connect(agent).swarmVote(GIG_ID, true)
      ).to.be.revertedWithCustomError(bond, "SelfDealingNotAllowed");
    });

    it("should revert on finalized gig", async function () {
      await bond.connect(voter1).swarmVote(GIG_ID, true);
      await bond.connect(voter2).swarmVote(GIG_ID, true);
      await bond.connect(voter3).swarmVote(GIG_ID, true);
      await expect(
        bond.connect(voter4).swarmVote(GIG_ID, true)
      ).to.be.revertedWithCustomError(bond, "GigAlreadyFinalized");
    });

    it("should revert when validator score is too low", async function () {
      await bond.updatePerformanceScore(voter1.address, 30);
      await expect(
        bond.connect(voter1).swarmVote(GIG_ID, true)
      ).to.be.revertedWithCustomError(bond, "ScoreTooLow");
    });

    it("should revert when validator has no score (zero)", async function () {
      const [,,,,,,,, unknownVoter] = await ethers.getSigners();
      await expect(
        bond.connect(unknownVoter).swarmVote(GIG_ID, true)
      ).to.be.revertedWithCustomError(bond, "ScoreTooLow");
    });
  });

  describe("slash cooldown", function () {
    it("should skip slash during cooldown and unlock instead", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.authorizeCaller(owner.address);
      await bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT);
      await bond.connect(voter1).swarmVote(GIG_ID, false);
      await bond.connect(voter2).swarmVote(GIG_ID, false);
      await bond.connect(voter3).swarmVote(GIG_ID, false);

      const slashAmount = LOCK_AMOUNT * 2000n / 10000n;
      const afterFirstSlash = DEPOSIT_AMOUNT - slashAmount;

      await bond.lockBondForGig(GIG_ID_2, agent.address, LOCK_AMOUNT);
      await bond.connect(voter1).swarmVote(GIG_ID_2, false);
      await bond.connect(voter2).swarmVote(GIG_ID_2, false);
      await bond.connect(voter3).swarmVote(GIG_ID_2, false);

      const b = await bond.getBond(agent.address);
      expect(b.totalDeposited).to.equal(afterFirstSlash);
      expect(b.locked).to.equal(0);
    });
  });

  describe("adminFinalize", function () {
    it("owner can admin finalize", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.authorizeCaller(owner.address);
      await bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT);
      await bond.adminFinalize(GIG_ID, true);
      const b = await bond.getBond(agent.address);
      expect(b.locked).to.equal(0);
      expect(b.available).to.equal(DEPOSIT_AMOUNT);
    });

    it("non-owner cannot admin finalize", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.authorizeCaller(owner.address);
      await bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT);
      await expect(
        bond.connect(voter1).adminFinalize(GIG_ID, true)
      ).to.be.revertedWithCustomError(bond, "OwnableUnauthorizedAccount");
    });
  });

  describe("pause", function () {
    it("owner can pause and unpause", async function () {
      await bond.pause();
      expect(await bond.paused()).to.equal(true);
      await bond.unpause();
      expect(await bond.paused()).to.equal(false);
    });

    it("non-owner cannot pause", async function () {
      await expect(
        bond.connect(voter1).pause()
      ).to.be.revertedWithCustomError(bond, "OwnableUnauthorizedAccount");
    });

    it("swarmVote reverts when paused", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.authorizeCaller(owner.address);
      await bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT);
      await bond.pause();
      await expect(
        bond.connect(voter1).swarmVote(GIG_ID, true)
      ).to.be.revertedWithCustomError(bond, "EnforcedPause");
    });
  });

  describe("getGigInfo + hasVoted", function () {
    it("returns gig info", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.authorizeCaller(owner.address);
      await bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT);
      const info = await bond.getGigInfo(GIG_ID);
      expect(info.agent).to.equal(agent.address);
      expect(info.lockedAmount).to.equal(LOCK_AMOUNT);
      expect(info.finalized).to.equal(false);
    });

    it("tracks voting correctly", async function () {
      await bond.connect(agent).deposit(DEPOSIT_AMOUNT);
      await bond.authorizeCaller(owner.address);
      await bond.lockBondForGig(GIG_ID, agent.address, LOCK_AMOUNT);
      expect(await bond.hasVoted(GIG_ID, voter1.address)).to.equal(false);
      await bond.connect(voter1).swarmVote(GIG_ID, true);
      expect(await bond.hasVoted(GIG_ID, voter1.address)).to.equal(true);
    });
  });
});
