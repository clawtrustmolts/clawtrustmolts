const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawTrustEscrow — additional coverage", function () {
  let escrow, swarmValidator, mockUsdc, mockClawCard, owner, depositor, payee, other, facilitator;
  const GIG_ID = ethers.id("esc-add-001");
  const FEE_RATE = 250;
  const AMOUNT = ethers.parseUnits("100", 6);

  beforeEach(async function () {
    [owner, depositor, payee, other, facilitator] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUsdc = await MockERC20.deploy("Mock USDC", "MUSDC", 6);

    const SwarmValidator = await ethers.getContractFactory("ClawTrustSwarmValidator");
    swarmValidator = await SwarmValidator.deploy(owner.address);

    const MockClawCard = await ethers.getContractFactory("MockClawCard");
    mockClawCard = await MockClawCard.deploy();
    await mockClawCard.setRegistered(payee.address, true);

    const Escrow = await ethers.getContractFactory("ClawTrustEscrow");
    escrow = await Escrow.deploy(
      await mockUsdc.getAddress(),
      await swarmValidator.getAddress(),
      FEE_RATE,
      await mockClawCard.getAddress(),
      ethers.ZeroAddress
    );

    await mockUsdc.mint(depositor.address, ethers.parseUnits("10000", 6));
    await mockUsdc.connect(depositor).approve(await escrow.getAddress(), ethers.MaxUint256);
    await mockUsdc.mint(facilitator.address, ethers.parseUnits("10000", 6));
  });

  // ─── lockUSDCViaX402 ──────────────────────────────────────────────

  describe("lockUSDCViaX402", function () {
    beforeEach(async function () {
      await escrow.connect(owner).setX402Facilitator(facilitator.address);
      await mockUsdc.connect(facilitator).approve(await escrow.getAddress(), ethers.MaxUint256);
    });

    it("should lock escrow via x402 facilitator", async function () {
      await escrow.connect(facilitator).lockUSDCViaX402(GIG_ID, depositor.address, payee.address, AMOUNT);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.amount).to.equal(AMOUNT);
      expect(e.depositor).to.equal(depositor.address);
    });

    it("should revert when called by non-facilitator", async function () {
      await expect(
        escrow.connect(other).lockUSDCViaX402(GIG_ID, depositor.address, payee.address, AMOUNT)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });

    it("should revert when poster is zero address", async function () {
      await expect(
        escrow.connect(facilitator).lockUSDCViaX402(GIG_ID, ethers.ZeroAddress, payee.address, AMOUNT)
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });

    it("should revert when poster == payee (self-dealing)", async function () {
      await expect(
        escrow.connect(facilitator).lockUSDCViaX402(GIG_ID, payee.address, payee.address, AMOUNT)
      ).to.be.revertedWithCustomError(escrow, "SelfDealingNotAllowed");
    });
  });

  // ─── Admin functions ──────────────────────────────────────────────

  describe("setX402Facilitator", function () {
    it("should set a new facilitator", async function () {
      await escrow.connect(owner).setX402Facilitator(facilitator.address);
      expect(await escrow.x402Facilitator()).to.equal(facilitator.address);
    });

    it("should revert on zero address", async function () {
      await expect(
        escrow.connect(owner).setX402Facilitator(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });

    it("should revert if called by non-owner", async function () {
      await expect(
        escrow.connect(other).setX402Facilitator(facilitator.address)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  describe("setPlatformFeeRate", function () {
    it("should update fee rate", async function () {
      await escrow.connect(owner).setPlatformFeeRate(500);
      expect(await escrow.platformFeeRate()).to.equal(500n);
    });

    it("should revert when fee exceeds MAX_FEE_RATE (1000)", async function () {
      await expect(
        escrow.connect(owner).setPlatformFeeRate(1001)
      ).to.be.revertedWithCustomError(escrow, "FeeTooHigh");
    });
  });

  describe("setTreasury", function () {
    it("should update treasury address", async function () {
      await escrow.connect(owner).setTreasury(other.address);
      expect(await escrow.treasury()).to.equal(other.address);
    });

    it("should revert on zero address", async function () {
      await expect(
        escrow.connect(owner).setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });
  });

  describe("setSwarmRequired", function () {
    it("should toggle swarm requirement on existing escrow", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      let e = await escrow.getEscrow(GIG_ID);
      const original = e.requiresSwarmValidation;
      await escrow.connect(owner).setSwarmRequired(GIG_ID, !original);
      e = await escrow.getEscrow(GIG_ID);
      expect(e.requiresSwarmValidation).to.equal(!original);
    });

    it("should revert for nonexistent escrow", async function () {
      await expect(
        escrow.connect(owner).setSwarmRequired(ethers.id("ghost"), true)
      ).to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });
  });

  describe("pause / unpause", function () {
    it("should pause and block lockUSDC", async function () {
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT)
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("should allow lockUSDC after unpause", async function () {
      await escrow.connect(owner).pause();
      await escrow.connect(owner).unpause();
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, AMOUNT);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.amount).to.equal(AMOUNT);
    });
  });

  describe("verifySwarmConnection", function () {
    it("should return true (connectivity check always returns true)", async function () {
      expect(await escrow.verifySwarmConnection()).to.equal(true);
    });
  });
});
