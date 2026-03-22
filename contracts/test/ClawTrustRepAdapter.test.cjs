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
      const score = await adapter.computeFusedScore(890, 4200, 75, 80);
      const normalizedOnChain = (890n * 100n) / 1000n;
      const normalizedMoltbook = (4200n * 100n) / 10000n;
      const expected = (30n * normalizedOnChain + 15n * normalizedMoltbook + 35n * 75n + 20n * 80n) / 100n;
      expect(score).to.equal(expected);
    });

    it("should return 0 for zero inputs", async function () {
      expect(await adapter.computeFusedScore(0, 0, 0, 0)).to.equal(0);
    });

    it("should return max for max inputs", async function () {
      expect(await adapter.computeFusedScore(1000, 10000, 100, 100)).to.equal(100);
    });

    it("should revert for out of bounds on-chain score", async function () {
      await expect(
        adapter.computeFusedScore(1001, 0, 0, 0)
      ).to.be.revertedWithCustomError(adapter, "ScoreOutOfBounds");
    });

    it("should revert for out of bounds moltbook karma", async function () {
      await expect(
        adapter.computeFusedScore(0, 10001, 0, 0)
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
        agent.address, 500, 5000, 75, 80, "ipfs://proof"
      );
      const score = await adapter.getFusedScore(agent.address);
      expect(score.onChainScore).to.equal(500);
      expect(score.moltbookKarma).to.equal(5000);
      expect(score.performanceScore).to.equal(75);
      expect(score.bondScore).to.equal(80);
      expect(score.fusedScore).to.be.gt(0);
    });

    it("non-oracle cannot update", async function () {
      await expect(
        adapter.connect(other).updateFusedScore(agent.address, 500, 5000, 75, 80, "ipfs://proof")
      ).to.be.revertedWithCustomError(adapter, "NotAuthorizedOracle");
    });

    it("should enforce rate limit", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, 75, 80, "ipfs://proof1");
      await expect(
        adapter.connect(oracle).updateFusedScore(agent.address, 600, 6000, 80, 90, "ipfs://proof2")
      ).to.be.revertedWithCustomError(adapter, "UpdateTooSoon");
    });

    it("should work after cooldown", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, 75, 80, "ipfs://proof1");
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");
      await adapter.connect(oracle).updateFusedScore(agent.address, 600, 6000, 80, 90, "ipfs://proof2");
      const score = await adapter.getFusedScore(agent.address);
      expect(score.onChainScore).to.equal(600);
    });

    it("should revert on empty proof", async function () {
      await expect(
        adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, 75, 80, "")
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
        [75, 80],
        [80, 90],
        ["ipfs://proof-001", "ipfs://p2"]
      );
      const s1 = await adapter.getFusedScore(addr1.address);
      const s2 = await adapter.getFusedScore(addr2.address);
      expect(s1.onChainScore).to.equal(500);
      expect(s2.onChainScore).to.equal(600);
    });

    it("should revert on batch too large", async function () {
      const addrs = [];
      const onChainScores = [];
      const karmas = [];
      const perfScores = [];
      const bondScores = [];
      const proofs = [];
      for (let i = 0; i < 51; i++) {
        addrs.push(ethers.Wallet.createRandom().address);
        onChainScores.push(100);
        karmas.push(1000);
        perfScores.push(50);
        bondScores.push(50);
        proofs.push("ipfs://p00");
      }
      await expect(
        adapter.connect(oracle).updateFusedScoreBatch(addrs, onChainScores, karmas, perfScores, bondScores, proofs)
      ).to.be.revertedWithCustomError(adapter, "BatchTooLarge");
    });

    it("should revert on array length mismatch", async function () {
      await expect(
        adapter.connect(oracle).updateFusedScoreBatch(
          [agent.address], [500, 600], [5000], [75], [80], ["ipfs://proof-001"]
        )
      ).to.be.revertedWithCustomError(adapter, "InvalidScore");
    });
  });

  describe("score history", function () {
    it("should track history", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, 75, 80, "ipfs://proof-001");
      const len = await adapter.getHistoryLength(agent.address);
      expect(len).to.equal(1);
      const history = await adapter.getScoreHistory(agent.address, 0, 10);
      expect(history.length).to.equal(1);
    });

    it("should paginate history", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, 75, 80, "ipfs://proof-001");
      const history = await adapter.getScoreHistory(agent.address, 10, 10);
      expect(history.length).to.equal(0);
    });
  });

  describe("pause", function () {
    it("should pause and unpause", async function () {
      await adapter.pause();
      await expect(
        adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, 75, 80, "ipfs://proof-001")
      ).to.be.revertedWithCustomError(adapter, "EnforcedPause");
      await adapter.unpause();
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, 75, 80, "ipfs://proof-001");
    });
  });

  describe("verifyProof", function () {
    it("should verify matching proof", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, 75, 80, "ipfs://proof");
      expect(await adapter.verifyProof(agent.address, "ipfs://proof")).to.equal(true);
    });

    it("should reject non-matching proof", async function () {
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 5000, 75, 80, "ipfs://proof");
      expect(await adapter.verifyProof(agent.address, "ipfs://wrong")).to.equal(false);
    });
  });
});
