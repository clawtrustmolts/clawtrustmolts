const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ClawTrustAC — additional coverage", function () {
  let clawTrustAC, mockUSDC, mockClawCard, owner, client, provider, evaluator, treasury, other;
  const ONE_DAY = 86400;
  const BUDGET = ethers.parseUnits("100", 6);

  beforeEach(async function () {
    [owner, client, provider, evaluator, treasury, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USDC", "USDC", 6);

    mockClawCard = await ethers.deployContract("MockClawCard");
    const mockRepAdapter = await ethers.deployContract("MockRepAdapter");
    const mockBond = await ethers.deployContract("MockBond");

    const ClawTrustAC = await ethers.getContractFactory("ClawTrustAC");
    clawTrustAC = await ClawTrustAC.deploy(
      await mockClawCard.getAddress(),
      await mockRepAdapter.getAddress(),
      await mockBond.getAddress(),
      await mockUSDC.getAddress(),
      treasury.address,
      evaluator.address
    );

    await mockUSDC.mint(client.address, ethers.parseUnits("10000", 6));
    await mockUSDC.connect(client).approve(await clawTrustAC.getAddress(), ethers.MaxUint256);
    await mockClawCard.setRegistered(provider.address, true);
  });

  async function createAndFundJob() {
    const tx = await clawTrustAC.connect(client).createJob("test task", BUDGET, ONE_DAY);
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => l.fragment && l.fragment.name === "JobCreated");
    const jobId = event.args.jobId;
    await clawTrustAC.connect(client).fund(jobId);
    return jobId;
  }

  // ─── getJobStatus ─────────────────────────────────────────────────

  describe("getJobStatus", function () {
    it("should return Funded status for funded job", async function () {
      const jobId = await createAndFundJob();
      expect(await clawTrustAC.getJobStatus(jobId)).to.equal(1n); // JobStatus.Funded
    });

    it("should revert JobNotFound for unknown jobId", async function () {
      await expect(
        clawTrustAC.getJobStatus(ethers.id("ghost"))
      ).to.be.revertedWithCustomError(clawTrustAC, "JobNotFound");
    });
  });

  // ─── jobCount / isRegisteredAgent / getStats ──────────────────────

  describe("read functions", function () {
    it("jobCount should start at 0 and increment", async function () {
      expect(await clawTrustAC.jobCount()).to.equal(0n);
      await clawTrustAC.connect(client).createJob("job1", BUDGET, ONE_DAY);
      expect(await clawTrustAC.jobCount()).to.equal(1n);
    });

    it("isRegisteredAgent should reflect ClawCard registration", async function () {
      expect(await clawTrustAC.isRegisteredAgent(provider.address)).to.equal(true);
      expect(await clawTrustAC.isRegisteredAgent(other.address)).to.equal(false);
    });

    it("getStats should return zeros initially", async function () {
      const stats = await clawTrustAC.getStats();
      expect(stats.created).to.equal(0n);
      expect(stats.completed).to.equal(0n);
      expect(stats.volumeUSDC).to.equal(0n);
      expect(stats.completionRate).to.equal(0n);
    });

    it("getStats completionRate should be 0 when no jobs created", async function () {
      const stats = await clawTrustAC.getStats();
      expect(stats.completionRate).to.equal(0n);
    });

    it("getStats should show correct created count after job creation", async function () {
      await clawTrustAC.connect(client).createJob("job", BUDGET, ONE_DAY);
      const stats = await clawTrustAC.getStats();
      expect(stats.created).to.equal(1n);
    });
  });

  // ─── Admin: setEvaluator, setTreasury ─────────────────────────────

  describe("setEvaluator", function () {
    it("should update the evaluator", async function () {
      await clawTrustAC.connect(owner).setEvaluator(other.address);
      expect(await clawTrustAC.evaluator()).to.equal(other.address);
    });

    it("should revert on zero address", async function () {
      await expect(
        clawTrustAC.connect(owner).setEvaluator(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidAddress");
    });

    it("should revert if called by non-owner", async function () {
      await expect(
        clawTrustAC.connect(other).setEvaluator(other.address)
      ).to.be.revertedWithCustomError(clawTrustAC, "OwnableUnauthorizedAccount");
    });
  });

  describe("setTreasury", function () {
    it("should update the treasury", async function () {
      await clawTrustAC.connect(owner).setTreasury(other.address);
      expect(await clawTrustAC.treasury()).to.equal(other.address);
    });

    it("should revert on zero address", async function () {
      await expect(
        clawTrustAC.connect(owner).setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidAddress");
    });
  });

  // ─── pause / unpause ──────────────────────────────────────────────

  describe("pause / unpause", function () {
    it("should pause and block createJob", async function () {
      await clawTrustAC.connect(owner).pause();
      await expect(
        clawTrustAC.connect(client).createJob("blocked", BUDGET, ONE_DAY)
      ).to.be.revertedWithCustomError(clawTrustAC, "EnforcedPause");
    });

    it("should allow operations after unpause", async function () {
      await clawTrustAC.connect(owner).pause();
      await clawTrustAC.connect(owner).unpause();
      await clawTrustAC.connect(client).createJob("after-unpause", BUDGET, ONE_DAY);
      expect(await clawTrustAC.jobCount()).to.equal(1n);
    });
  });

  // ─── emergencyWithdraw ────────────────────────────────────────────

  describe("emergencyWithdraw", function () {
    it("should withdraw non-USDC tokens by owner", async function () {
      // Deploy a different ERC20 and send it to the contract
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const otherToken = await MockERC20.deploy("Other", "OTH", 18);
      const amount = ethers.parseEther("50");
      await otherToken.mint(await clawTrustAC.getAddress(), amount);

      const before = await otherToken.balanceOf(owner.address);
      await clawTrustAC.connect(owner).emergencyWithdraw(
        await otherToken.getAddress(), owner.address, amount
      );
      const after = await otherToken.balanceOf(owner.address);
      expect(after - before).to.equal(amount);
    });

    it("should revert when trying to withdraw USDC (protected)", async function () {
      await expect(
        clawTrustAC.connect(owner).emergencyWithdraw(
          await mockUSDC.getAddress(), owner.address, 1n
        )
      ).to.be.revertedWithCustomError(clawTrustAC, "Unauthorized");
    });

    it("should revert on zero-address recipient", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const otherToken = await MockERC20.deploy("O", "O", 18);
      await expect(
        clawTrustAC.connect(owner).emergencyWithdraw(
          await otherToken.getAddress(), ethers.ZeroAddress, 1n
        )
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidAddress");
    });
  });

  // ─── recoverStuckUSDC ─────────────────────────────────────────────

  describe("recoverStuckUSDC", function () {
    it("should transfer all USDC balance to given address", async function () {
      // Send USDC directly to contract (simulating stuck funds)
      await mockUSDC.mint(await clawTrustAC.getAddress(), ethers.parseUnits("50", 6));

      const before = await mockUSDC.balanceOf(other.address);
      await clawTrustAC.connect(owner).recoverStuckUSDC(other.address);
      const after = await mockUSDC.balanceOf(other.address);
      expect(after - before).to.equal(ethers.parseUnits("50", 6));
    });

    it("should revert on zero-address recipient", async function () {
      await expect(
        clawTrustAC.connect(owner).recoverStuckUSDC(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(clawTrustAC, "InvalidAddress");
    });

    it("should revert if called by non-owner", async function () {
      await expect(
        clawTrustAC.connect(other).recoverStuckUSDC(other.address)
      ).to.be.revertedWithCustomError(clawTrustAC, "OwnableUnauthorizedAccount");
    });
  });
});
