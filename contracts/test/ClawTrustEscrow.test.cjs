const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawTrustEscrow", function () {
  let escrow, swarmValidator, mockToken, owner, depositor, payee, other;
  const GIG_ID = ethers.id("gig-001");
  const GIG_ID_2 = ethers.id("gig-002");
  const FEE_RATE = 250;

  beforeEach(async function () {
    [owner, depositor, payee, other] = await ethers.getSigners();

    const SwarmValidator = await ethers.getContractFactory("ClawTrustSwarmValidator");
    swarmValidator = await SwarmValidator.deploy(owner.address);
    await swarmValidator.waitForDeployment();

    const Escrow = await ethers.getContractFactory("ClawTrustEscrow");
    escrow = await Escrow.deploy(await swarmValidator.getAddress(), FEE_RATE);
    await escrow.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "MUSDC", 6);
    await mockToken.waitForDeployment();

    await escrow.setTokenApproval(await mockToken.getAddress(), true);
    await mockToken.mint(depositor.address, ethers.parseUnits("10000", 6));
    await mockToken.connect(depositor).approve(await escrow.getAddress(), ethers.parseUnits("10000", 6));
  });

  describe("lockETH", function () {
    it("should lock ETH escrow", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.depositor).to.equal(depositor.address);
      expect(e.payee).to.equal(payee.address);
      expect(e.amount).to.equal(ethers.parseEther("1"));
      expect(e.status).to.equal(1);
    });

    it("should revert on duplicate gigId", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await expect(
        escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(escrow, "EscrowAlreadyExists");
    });

    it("should revert on zero value", async function () {
      await expect(
        escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: 0 })
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("should revert on self-dealing", async function () {
      await expect(
        escrow.connect(depositor).lockETH(GIG_ID, depositor.address, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(escrow, "SelfDealingNotAllowed");
    });

    it("should revert below minimum amount", async function () {
      await expect(
        escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: 100 })
      ).to.be.revertedWithCustomError(escrow, "BelowMinimumAmount");
    });

    it("should revert on zero gigId", async function () {
      await expect(
        escrow.connect(depositor).lockETH(ethers.ZeroHash, payee.address, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(escrow, "InvalidGigId");
    });
  });

  describe("lockERC20", function () {
    it("should lock ERC20 escrow", async function () {
      const amount = ethers.parseUnits("100", 6);
      await escrow.connect(depositor).lockERC20(GIG_ID, payee.address, await mockToken.getAddress(), amount);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.amount).to.equal(amount);
      expect(e.token).to.equal(await mockToken.getAddress());
    });

    it("should revert on unapproved token", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const badToken = await MockERC20.deploy("Bad", "BAD", 18);
      await expect(
        escrow.connect(depositor).lockERC20(GIG_ID, payee.address, await badToken.getAddress(), 10000)
      ).to.be.revertedWithCustomError(escrow, "TokenNotApproved");
    });

    it("should revert on self-dealing", async function () {
      await expect(
        escrow.connect(depositor).lockERC20(GIG_ID, depositor.address, await mockToken.getAddress(), 10000)
      ).to.be.revertedWithCustomError(escrow, "SelfDealingNotAllowed");
    });
  });

  describe("release", function () {
    it("should release ETH to payee with fee", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      const payeeBefore = await ethers.provider.getBalance(payee.address);
      await escrow.connect(depositor).release(GIG_ID);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(2);
      const payeeAfter = await ethers.provider.getBalance(payee.address);
      expect(payeeAfter).to.be.gt(payeeBefore);
    });

    it("should revert if not depositor or owner", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await expect(
        escrow.connect(other).release(GIG_ID)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });

    it("should revert if already released", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await escrow.connect(depositor).release(GIG_ID);
      await expect(
        escrow.connect(depositor).release(GIG_ID)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("refund", function () {
    it("should refund ETH to depositor", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      const before = await ethers.provider.getBalance(depositor.address);
      await escrow.connect(depositor).refund(GIG_ID);
      const after = await ethers.provider.getBalance(depositor.address);
      expect(after).to.be.gt(before);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(3);
    });

    it("should refund ERC20 to depositor", async function () {
      const amount = ethers.parseUnits("100", 6);
      await escrow.connect(depositor).lockERC20(GIG_ID, payee.address, await mockToken.getAddress(), amount);
      const before = await mockToken.balanceOf(depositor.address);
      await escrow.connect(depositor).refund(GIG_ID);
      const after = await mockToken.balanceOf(depositor.address);
      expect(after - before).to.equal(amount);
    });
  });

  describe("refundAfterTimeout", function () {
    it("should refund after timeout", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await ethers.provider.send("evm_increaseTime", [90 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await escrow.connect(other).refundAfterTimeout(GIG_ID);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(3);
    });

    it("should revert before timeout", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await expect(
        escrow.connect(other).refundAfterTimeout(GIG_ID)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });
  });

  describe("dispute + resolveDispute", function () {
    it("depositor can dispute", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await escrow.connect(depositor).dispute(GIG_ID);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(4);
    });

    it("payee can dispute", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await escrow.connect(payee).dispute(GIG_ID);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(4);
    });

    it("random user cannot dispute", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await expect(
        escrow.connect(other).dispute(GIG_ID)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });

    it("owner can resolve dispute and release to payee", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await escrow.connect(depositor).dispute(GIG_ID);
      const before = await ethers.provider.getBalance(payee.address);
      await escrow.connect(owner).resolveDispute(GIG_ID, true);
      const after = await ethers.provider.getBalance(payee.address);
      expect(after).to.be.gt(before);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(2);
    });

    it("owner can resolve dispute and refund to depositor", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await escrow.connect(depositor).dispute(GIG_ID);
      await escrow.connect(owner).resolveDispute(GIG_ID, false);
      const e = await escrow.getEscrow(GIG_ID);
      expect(e.status).to.equal(3);
    });

    it("non-owner cannot resolve dispute", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await escrow.connect(depositor).dispute(GIG_ID);
      await expect(
        escrow.connect(depositor).resolveDispute(GIG_ID, true)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("cannot resolve non-disputed escrow", async function () {
      await escrow.connect(depositor).lockETH(GIG_ID, payee.address, { value: ethers.parseEther("1") });
      await expect(
        escrow.connect(owner).resolveDispute(GIG_ID, true)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
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

  describe("getEscrow", function () {
    it("should revert for non-existent escrow", async function () {
      await expect(escrow.getEscrow(GIG_ID)).to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });
  });
});
