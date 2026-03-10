const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawTrustAC", function () {
  let clawTrustAC;
  let mockUSDC;
  let mockClawCard;
  let owner, client, provider, evaluator, treasury, other;

  const ONE_DAY = 86400;
  const BUDGET = ethers.parseUnits("100", 6);

  beforeEach(async function () {
    [owner, client, provider, evaluator, treasury, other] = await ethers.getSigners();

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
    it("assigns a registered provider", async function () {
      const jobId = await createAndFundJob();
      await clawTrustAC.connect(client).assignProvider(jobId, provider.address);
      const job = await clawTrustAC.getJob(jobId);
      expect(job.provider).to.equal(provider.address);
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
      expect(job.status).to.equal(2);
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
      expect(job.status).to.equal(3);
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
      expect(job.status).to.equal(4);
    });
  });

  describe("cancel", function () {
    it("client can cancel funded job and get refund", async function () {
      const jobId = await createAndFundJob();
      const clientBalBefore = await mockUSDC.balanceOf(client.address);
      await clawTrustAC.connect(client).cancel(jobId);
      expect(await mockUSDC.balanceOf(client.address)).to.equal(clientBalBefore + BUDGET);
      const job = await clawTrustAC.getJob(jobId);
      expect(job.status).to.equal(5);
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
