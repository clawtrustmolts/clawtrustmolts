const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawTrustRepAdapter", function () {
  let adapter, owner, oracle, agent, other;
  const REGISTRY_ADDR = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

  beforeEach(async function () {
    [owner, oracle, agent, other] = await ethers.getSigners();

    const Adapter = await ethers.getContractFactory("ClawTrustRepAdapter");
    adapter = await Adapter.deploy(REGISTRY_ADDR);
    await adapter.waitForDeployment();

    await adapter.authorizeOracle(oracle.address);
  });

  describe("computeFusedScore", function () {
    it("should compute correct fused score", async function () {
      const score = await adapter.computeFusedScore(890, 4200);
      const expected = (60n * (890n * 100n / 1000n) + 40n * (4200n * 100n / 10000n)) / 100n;
      expect(score).to.equal(expected);
    });

    it("should return 0 for zero inputs", async function () {
      expect(await adapter.computeFusedScore(0, 0)).to.equal(0);
    });

    it("should return max for max inputs", async function () {
      expect(await adapter.computeFusedScore(1000, 10000)).to.equal(100);
    });

    it("should revert for out of bounds on-chain score", async function () {
      await expect(
        adapter.computeFusedScore(1001, 0)
      ).to.be.revertedWithCustomError(adapter, "ScoreOutOfBounds");
    });

    it("should revert for out of bounds moltbook karma", async function () {
      await expect(
        adapter.computeFusedScore(0, 10001)
      ).to.be.revertedWithCustomError(adapter, "ScoreOutOfBounds");
    });
  });

  describe("oracle management", function () {
    it("should authorize oracle", async function () {
      expect(await adapter.authorizedOracles(oracle.address)).to.equal(true);
      expect(await adapter.oracleCount()).to.equal(1);
    });

    it("should revoke oracle", async function () {
      await adapter.authorizeOracle(other.address);
      await adapter.revokeOracle(oracle.address);
      expect(await adapter.authorizedOracles(oracle.address)).to.equal(false);
      expect(await adapter.oracleCount()).to.equal(1);
    });

    it("should revert revoking last oracle below min count", async function () {
      await expect(
        adapter.revokeOracle(oracle.address)
      ).to.be.revertedWithCustomError(adapter, "InsufficientOracles");
    });

    it("non-owner cannot authorize", async function () {
      await expect(
        adapter.connect(other).authorizeOracle(other.address)
      ).to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount");
    });
  });

  describe("updateFusedScore", function () {
    it("oracle can update fused score", async function () {
      await adapter.connect(oracle).updateFusedScore(
        agent.address, 500, 5000, "ipfs://proof"
      );
      const score = await adapter.getFusedScore(agent.address);
      expect(score.onChainScore).to.equal(500);
      expect(score.moltbookKarma).to.equal(5000);
      expect(score.fusedScore).to.be.gt(0);
    });

    it("non-oracle cannot update", async function () {
      await expect(
        adapter.connect(other).updateFusedScore(agent.address, 500, 5000, "ipfs://proof")
      ).to.be.revertedWithCustomError(adapter, "NotAuthorizedOracle");
    });

    it("should enforce rate limit", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, "ipfs://proof1");
      await expect(
        adapter.connect(oracle).updateFusedScore(agent.address, 600, 6000, "ipfs://proof2")
      ).to.be.revertedWithCustomError(adapter, "UpdateTooSoon");
    });

    it("should work after cooldown", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, "ipfs://proof1");
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");
      await adapter.connect(oracle).updateFusedScore(agent.address, 600, 6000, "ipfs://proof2");
      const score = await adapter.getFusedScore(agent.address);
      expect(score.onChainScore).to.equal(600);
    });

    it("should revert on empty proof", async function () {
      await expect(
        adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, "")
      ).to.be.revertedWithCustomError(adapter, "InvalidProof");
    });
  });

  describe("updateFusedScoreBatch", function () {
    it("should batch update", async function () {
      const [, , , addr1, addr2] = await ethers.getSigners();
      await adapter.connect(oracle).updateFusedScoreBatch(
        [addr1.address, addr2.address],
        [500, 600],
        [5000, 6000],
        ["ipfs://p1", "ipfs://p2"]
      );
      const s1 = await adapter.getFusedScore(addr1.address);
      const s2 = await adapter.getFusedScore(addr2.address);
      expect(s1.onChainScore).to.equal(500);
      expect(s2.onChainScore).to.equal(600);
    });

    it("should revert on batch too large", async function () {
      const addrs = [];
      const scores = [];
      const karmas = [];
      const proofs = [];
      for (let i = 0; i < 51; i++) {
        addrs.push(ethers.Wallet.createRandom().address);
        scores.push(100);
        karmas.push(1000);
        proofs.push("ipfs://p");
      }
      await expect(
        adapter.connect(oracle).updateFusedScoreBatch(addrs, scores, karmas, proofs)
      ).to.be.revertedWithCustomError(adapter, "BatchTooLarge");
    });

    it("should revert on array length mismatch", async function () {
      await expect(
        adapter.connect(oracle).updateFusedScoreBatch(
          [agent.address], [500, 600], [5000], ["ipfs://p1"]
        )
      ).to.be.revertedWithCustomError(adapter, "InvalidScore");
    });
  });

  describe("score history", function () {
    it("should track history", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, "ipfs://p1");
      const len = await adapter.getHistoryLength(agent.address);
      expect(len).to.equal(1);
      const history = await adapter.getScoreHistory(agent.address, 0, 10);
      expect(history.length).to.equal(1);
    });

    it("should paginate history", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, "ipfs://p1");
      const history = await adapter.getScoreHistory(agent.address, 10, 10);
      expect(history.length).to.equal(0);
    });
  });

  describe("pause", function () {
    it("should pause and unpause", async function () {
      await adapter.pause();
      await expect(
        adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, "ipfs://p1")
      ).to.be.revertedWithCustomError(adapter, "EnforcedPause");
      await adapter.unpause();
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, "ipfs://p1");
    });
  });

  describe("verifyProof", function () {
    it("should verify matching proof", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, "ipfs://proof");
      expect(await adapter.verifyProof(agent.address, "ipfs://proof")).to.equal(true);
    });

    it("should reject non-matching proof", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, "ipfs://proof");
      expect(await adapter.verifyProof(agent.address, "ipfs://wrong")).to.equal(false);
    });
  });
});
