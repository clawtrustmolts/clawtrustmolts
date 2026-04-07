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

  // ─── TVL cap + per-gig cap ──────────────────────────────────────

  describe("deposit cap: maxGigAmount", function () {
    const CAP = ethers.parseUnits("1000", 6); // $1K cap for test

    beforeEach(async function () {
      await mockUsdc.mint(depositor.address, ethers.parseUnits("10000", 6));
      await mockUsdc.connect(depositor).approve(await escrow.getAddress(), ethers.MaxUint256);
    });

    it("default maxGigAmount is 50,000 USDC", async function () {
      expect(await escrow.maxGigAmount()).to.equal(ethers.parseUnits("50000", 6));
    });

    it("owner can lower the per-gig cap", async function () {
      await escrow.connect(owner).setMaxGigAmount(CAP);
      expect(await escrow.maxGigAmount()).to.equal(CAP);
    });

    it("setMaxGigAmount emits MaxGigAmountUpdated", async function () {
      const old = await escrow.maxGigAmount();
      await expect(escrow.connect(owner).setMaxGigAmount(CAP))
        .to.emit(escrow, "MaxGigAmountUpdated")
        .withArgs(old, CAP);
    });

    it("lockUSDC reverts when amount exceeds cap", async function () {
      await escrow.connect(owner).setMaxGigAmount(CAP);
      const over = CAP + 1n;

      await expect(
        escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, over)
      ).to.be.revertedWithCustomError(escrow, "GigAmountExceedsCap");
    });

    it("lockUSDC succeeds at exactly the cap", async function () {
      await escrow.connect(owner).setMaxGigAmount(CAP);
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, CAP);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.amount).to.equal(CAP);
    });

    it("setting cap to 0 disables the check (unlimited)", async function () {
      await escrow.connect(owner).setMaxGigAmount(0);
      const bigAmount = ethers.parseUnits("5000", 6);
      await mockUsdc.mint(depositor.address, bigAmount);
      // Should not revert
      await escrow.connect(depositor).lockUSDC(GIG_ID, payee.address, bigAmount);
    });

    it("non-owner cannot change the cap", async function () {
      await expect(
        escrow.connect(depositor).setMaxGigAmount(CAP)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  describe("TVL cap: maxTVL + totalLockedUSDC", function () {
    const GIG_A = ethers.id("tvl-gig-A");
    const GIG_B = ethers.id("tvl-gig-B");
    const GIG_C = ethers.id("tvl-gig-C");
    const UNIT = ethers.parseUnits("100", 6); // $100 per gig

    beforeEach(async function () {
      await mockUsdc.mint(depositor.address, ethers.parseUnits("10000", 6));
      await mockUsdc.connect(depositor).approve(await escrow.getAddress(), ethers.MaxUint256);
      // Set a tight TVL cap: $250
      await escrow.connect(owner).setMaxTVL(ethers.parseUnits("250", 6));
      // Also remove per-gig cap so it doesn't interfere
      await escrow.connect(owner).setMaxGigAmount(0);
    });

    it("default maxTVL is 500,000 USDC", async function () {
      const fresh = await ethers.deployContract("ClawTrustEscrow", [
        await mockUsdc.getAddress(),
        await (await ethers.getContractFactory("ClawTrustSwarmValidator")).deploy(owner.address).then(c => c.getAddress()),
        250,
        await mockUsdc.getAddress(), // placeholder
        ethers.ZeroAddress
      ]);
      expect(await fresh.maxTVL()).to.equal(ethers.parseUnits("500000", 6));
    });

    it("totalLockedUSDC starts at 0", async function () {
      expect(await escrow.totalLockedUSDC()).to.equal(0);
    });

    it("totalLockedUSDC increases on each lockUSDC", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_A, payee.address, UNIT);
      expect(await escrow.totalLockedUSDC()).to.equal(UNIT);
      await escrow.connect(depositor).lockUSDC(GIG_B, payee.address, UNIT);
      expect(await escrow.totalLockedUSDC()).to.equal(UNIT * 2n);
    });

    it("lockUSDC reverts when TVL cap would be exceeded", async function () {
      // Lock $100 + $100 = $200 (within $250 cap)
      await escrow.connect(depositor).lockUSDC(GIG_A, payee.address, UNIT);
      await escrow.connect(depositor).lockUSDC(GIG_B, payee.address, UNIT);
      // Third $100 would make $300 > $250 cap
      await expect(
        escrow.connect(depositor).lockUSDC(GIG_C, payee.address, UNIT)
      ).to.be.revertedWithCustomError(escrow, "TVLCapExceeded");
    });

    it("totalLockedUSDC decreases when a gig is released", async function () {
      // lockUSDCDirect: requiresSwarmValidation = false, so release() works without swarm approval
      await escrow.connect(depositor).lockUSDCDirect(GIG_A, payee.address, UNIT);
      expect(await escrow.totalLockedUSDC()).to.equal(UNIT);
      await escrow.connect(depositor).release(GIG_A);
      expect(await escrow.totalLockedUSDC()).to.equal(0n);
    });

    it("totalLockedUSDC decreases when a gig is refunded", async function () {
      await escrow.connect(depositor).lockUSDC(GIG_A, payee.address, UNIT);
      await escrow.connect(depositor).refund(GIG_A);
      expect(await escrow.totalLockedUSDC()).to.equal(0n);
    });

    it("can lock again after a gig is released (TVL freed up)", async function () {
      // lockUSDCDirect for GIG_A so release() doesn't require swarm approval
      await escrow.connect(depositor).lockUSDCDirect(GIG_A, payee.address, UNIT);
      await escrow.connect(depositor).lockUSDC(GIG_B, payee.address, UNIT);
      // Release one → TVL back to $100
      await escrow.connect(depositor).release(GIG_A);
      // Can now lock $100 again (total $200 < $250 cap)
      await escrow.connect(depositor).lockUSDC(GIG_C, payee.address, UNIT);
      expect(await escrow.totalLockedUSDC()).to.equal(UNIT * 2n);
    });

    it("remainingTVLCapacity returns correct headroom", async function () {
      const cap = ethers.parseUnits("250", 6);
      await escrow.connect(depositor).lockUSDC(GIG_A, payee.address, UNIT);
      const remaining = await escrow.remainingTVLCapacity();
      expect(remaining).to.equal(cap - UNIT);
    });

    it("remainingTVLCapacity returns max uint256 when cap is disabled", async function () {
      await escrow.connect(owner).setMaxTVL(0);
      expect(await escrow.remainingTVLCapacity()).to.equal(ethers.MaxUint256);
    });

    it("remainingTVLCapacity returns 0 when fully capped", async function () {
      await escrow.connect(owner).setMaxTVL(UNIT);
      await escrow.connect(depositor).lockUSDC(GIG_A, payee.address, UNIT);
      expect(await escrow.remainingTVLCapacity()).to.equal(0n);
    });

    it("setMaxTVL emits MaxTVLUpdated event", async function () {
      const old = await escrow.maxTVL();
      const newCap = ethers.parseUnits("1000000", 6);
      await expect(escrow.connect(owner).setMaxTVL(newCap))
        .to.emit(escrow, "MaxTVLUpdated")
        .withArgs(old, newCap);
    });

    it("setting TVL cap to 0 disables it (unlimited)", async function () {
      // Fill to $200
      await escrow.connect(depositor).lockUSDC(GIG_A, payee.address, UNIT);
      await escrow.connect(depositor).lockUSDC(GIG_B, payee.address, UNIT);
      // Remove cap
      await escrow.connect(owner).setMaxTVL(0);
      // Can now add more even beyond old $250 cap
      await escrow.connect(depositor).lockUSDC(GIG_C, payee.address, UNIT);
      expect(await escrow.totalLockedUSDC()).to.equal(UNIT * 3n);
    });
  });
});
