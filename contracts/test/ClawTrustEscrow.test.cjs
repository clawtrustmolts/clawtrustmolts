const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawTrustEscrow", function () {
  let escrow, swarmValidator, mockUsdc, mockClawCard, owner, depositor, payee, other;
  const GIG_ID = ethers.id("gig-001");
  const GIG_ID_2 = ethers.id("gig-002");
  const FEE_RATE = 250;
  const AMOUNT = ethers.parseUnits("100", 6);

  beforeEach(async function () {
    [owner, depositor, payee, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUsdc = await MockERC20.deploy("Mock USDC", "MUSDC", 6);
    await mockUsdc.waitForDeployment();

    const SwarmValidator = await ethers.getContractFactory("ClawTrustSwarmValidator");
    swarmValidator = await SwarmValidator.deploy(owner.address);
    await swarmValidator.waitForDeployment();

    const MockClawCard = await ethers.getContractFactory("MockClawCard");
    mockClawCard = await MockClawCard.deploy();
    await mockClawCard.waitForDeployment();
    // Register payee so identity check passes
    await mockClawCard.setRegistered(payee.address, true);

    const Escrow = await ethers.getContractFactory("ClawTrustEscrow");
    escrow = await Escrow.deploy(
      await mockUsdc.getAddress(),
      await swarmValidator.getAddress(),
      FEE_RATE,
      await mockClawCard.getAddress(),
      ethers.ZeroAddress
    );
    await escrow.waitForDeployment();

    await mockUsdc.mint(depositor.address, ethers.parseUnits("10000", 6));
    await mockUsdc.connect(depositor).approve(await escrow.getAddress(), ethers.parseUnits("10000", 6));
  });

  describe("lockUSDC", function () {
    it("should lock USDC escrow with requiresSwarmValidation=true", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.amount).to.equal(AMOUNT);
      expect(e.status).to.equal(1);
      expect(e.depositor).to.equal(depositor.address);
      expect(e.payee).to.equal(payee.address);
      expect(e.requiresSwarmValidation).to.equal(true);
    });

    it("should revert on duplicate gigId", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await expect(
        escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT)
      ).to.be.revertedWithCustomError(escrow, "EscrowAlreadyExists");
    });

    it("should revert on self-dealing", async function () {
      await expect(
        escrow.connect(depositor).lockUSDC(GIG_ID, depositor.address, AMOUNT)
      ).to.be.revertedWithCustomError(escrow, "SelfDealingNotAllowed");
    });

    it("should revert below minimum amount", async function () {
      await expect(
        escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, 100)
      ).to.be.revertedWithCustomError(escrow, "BelowMinimumAmount");
    });

    it("should revert if payee is not a registered agent", async function () {
      await mockClawCard.setRegistered(other.address, false);
      await expect(
        escrow.connect(depositor).lockUSDC(GIG_ID, other.address, AMOUNT)
      ).to.be.revertedWithCustomError(escrow, "PayeeNotRegisteredAgent");
    });
  });

  describe("lockUSDCDirect", function () {
    it("should lock USDC with requiresSwarmValidation=false", async function () {
      await escrow.connect(depositor).lockUSDCDirect(GIG_ID, payee.address, AMOUNT);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.requiresSwarmValidation).to.equal(false);
    });
  });

  describe("release", function () {
    it("should release USDC to payee with fee (using lockUSDCDirect)", async function () {
      await escrow.connect(depositor).lockUSDCDirect(GIG_ID, payee.address, AMOUNT);
      const payeeBefore = await mockUsdc.balanceOf(payee.address);
      await escrow.connect(depositor).release(GIG_ID);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(2);
      const payeeAfter = await mockUsdc.balanceOf(payee.address);
      const fee = (AMOUNT * BigInt(FEE_RATE)) / 10000n;
      expect(payeeAfter - payeeBefore).to.equal(AMOUNT - fee);
    });

    it("should revert if not depositor or owner", async function () {
      await escrow.connect(depositor).lockUSDCDirect(GIG_ID, payee.address, AMOUNT);
      await expect(
        escrow.connect(other).release(GIG_ID)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });

    it("should revert if already released", async function () {
      await escrow.connect(depositor).lockUSDCDirect(GIG_ID, payee.address, AMOUNT);
      await escrow.connect(depositor).release(GIG_ID);
      await expect(
        escrow.connect(depositor).release(GIG_ID)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("should revert with SwarmNotApproved when requiresSwarmValidation=true", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await expect(
        escrow.connect(depositor).release(GIG_ID)
      ).to.be.revertedWithCustomError(escrow, "SwarmNotApproved");
    });

    it("should allow release after setSwarmRequired(false)", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await escrow.connect(owner).setSwarmRequired(GIG_ID, false);
      await escrow.connect(depositor).release(GIG_ID);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(2);
    });
  });

  describe("refund", function () {
    it("should refund USDC to depositor", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      const before = await mockUsdc.balanceOf(depositor.address);
      await escrow.connect(depositor).refund(GIG_ID);
      const after = await mockUsdc.balanceOf(depositor.address);
      expect(after - before).to.equal(AMOUNT);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(3);
    });
  });

  describe("refundAfterTimeout", function () {
    it("should refund after timeout", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await ethers.provider.send("evm_increaseTime", [90 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await escrow.connect(other).refundAfterTimeout(GIG_ID);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(3);
    });

    it("should revert before timeout", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await expect(
        escrow.connect(other).refundAfterTimeout(GIG_ID)
      ).to.be.revertedWithCustomError(escrow, "EscrowNotTimedOut");
    });
  });

  describe("dispute + resolveDispute", function () {
    it("depositor can dispute", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await escrow.connect(depositor).dispute(GIG_ID);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(4);
      expect(e.disputedAt).to.be.gt(0);
    });

    it("payee can dispute", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await escrow.connect(payee).dispute(GIG_ID);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(4);
    });

    it("random user cannot dispute", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await expect(
        escrow.connect(other).dispute(GIG_ID)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });

    it("owner can resolve dispute and release to payee", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await escrow.connect(depositor).dispute(GIG_ID);
      const before = await mockUsdc.balanceOf(payee.address);
      await escrow.connect(owner).resolveDispute(GIG_ID, true);
      const after = await mockUsdc.balanceOf(payee.address);
      expect(after).to.be.gt(before);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(2);
    });

    it("owner can resolve dispute and refund to depositor", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await escrow.connect(depositor).dispute(GIG_ID);
      await escrow.connect(owner).resolveDispute(GIG_ID, false);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(3);
    });

    it("non-owner cannot resolve dispute", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await escrow.connect(depositor).dispute(GIG_ID);
      await expect(
        escrow.connect(depositor).resolveDispute(GIG_ID, true)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("cannot resolve non-disputed escrow", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      await expect(
        escrow.connect(owner).resolveDispute(GIG_ID, true)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("claimAfterDisputeTimeout", function () {
    it("should release to payee after dispute timeout", async function () {
      await escrow.connect(depositor).lockUSDCDirect(GIG_ID, payee.address, AMOUNT);
      await escrow.connect(depositor).dispute(GIG_ID);
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      const before = await mockUsdc.balanceOf(payee.address);
      await escrow.connect(other).claimAfterDisputeTimeout(GIG_ID);
      const after = await mockUsdc.balanceOf(payee.address);
      expect(after).to.be.gt(before);
    });

    it("should revert before timeout", async function () {
      await escrow.connect(depositor).lockUSDCDirect(GIG_ID, payee.address, AMOUNT);
      await escrow.connect(depositor).dispute(GIG_ID);
      await expect(
        escrow.connect(other).claimAfterDisputeTimeout(GIG_ID)
      ).to.be.revertedWithCustomError(escrow, "DisputeTimeoutNotReached");
    });
  });

  describe("verifySwarmConnection", function () {
    it("should return true", async function () {
      expect(await escrow.verifySwarmConnection()).to.equal(true);
    });
  });

  describe("setPlatformFeeRate", function () {
    it("owner can set fee rate", async function () {
      await escrow.setPlatformFeeRate(500);
      expect(await escrow.platformFeeRate()).to.equal(500);
    });

    it("reverts on fee too high", async function () {
      await expect(escrow.setPlatformFeeRate(1001)).to.be.revertedWithCustomError(escrow, "FeeTooHigh");
    });
  });

  describe("setTreasury", function () {
    it("owner can set treasury", async function () {
      await escrow.setTreasury(other.address);
      expect(await escrow.treasury()).to.equal(other.address);
    });

    it("reverts on zero address", async function () {
      await expect(escrow.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });
  });

  describe("getEscrow", function () {
    it("should revert for non-existent escrow", async function () {
      await expect(escrow.getEscrow(GIG_ID)).to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });
  });
});
