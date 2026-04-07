const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ClawTrustRepAdapter — additional coverage", function () {
  let adapter, mockRegistry, owner, oracle, oracle2, agent, other;

  beforeEach(async function () {
    [owner, oracle, oracle2, agent, other] = await ethers.getSigners();

    mockRegistry = await ethers.deployContract("MockRepRegistry");

    const Adapter = await ethers.getContractFactory("ClawTrustRepAdapter");
    adapter = await Adapter.deploy(await mockRegistry.getAddress());
    await adapter.waitForDeployment();

    await adapter.authorizeOracle(oracle.address);
  });

  // ─── submitFeedback ───────────────────────────────────────────────

  describe("submitFeedback (oracle function)", function () {
    it("should allow authorized oracle to submit feedback and increase count", async function () {
      await adapter.connect(oracle).submitFeedback(
        agent.address, 80, ["performance"], "ipfs://proof1234"
      );
      expect(await adapter.getFeedbackCount(agent.address)).to.equal(1n);
    });

    it("should emit FeedbackSubmitted and ScoreUpdated", async function () {
      await expect(
        adapter.connect(oracle).submitFeedback(agent.address, 70, ["speed"], "ipfs://proof1111")
      )
        .to.emit(adapter, "FeedbackSubmitted")
        .to.emit(adapter, "ScoreUpdated");
    });

    it("should revert for non-oracle caller", async function () {
      await expect(
        adapter.connect(other).submitFeedback(agent.address, 50, [], "ipfs://proof1234")
      ).to.be.revertedWithCustomError(adapter, "NotAuthorizedOracle");
    });

    it("should revert for zero address recipient", async function () {
      await expect(
        adapter.connect(oracle).submitFeedback(ethers.ZeroAddress, 50, [], "ipfs://proof1234")
      ).to.be.revertedWithCustomError(adapter, "InvalidAddress");
    });

    it("should revert for short proofUri (< 10 chars)", async function () {
      await expect(
        adapter.connect(oracle).submitFeedback(agent.address, 50, [], "short")
      ).to.be.revertedWithCustomError(adapter, "InvalidProof");
    });

    it("should revert when paused", async function () {
      await adapter.connect(owner).pause();
      await expect(
        adapter.connect(oracle).submitFeedback(agent.address, 50, [], "ipfs://proof9999")
      ).to.be.revertedWithCustomError(adapter, "EnforcedPause");
    });
  });

  // ─── getReputation and _computeTier ──────────────────────────────
  // FusedScore formula: (30*onChain/10 + 15*moltbook/100 + 35*perf + 20*bond) / 100
  // onChain max=1000 (→ normalised to 0-100 by /10), moltbook max=10000 (→ /100)
  // perf and bond are 0-100 directly.

  describe("getReputation / tier computation", function () {
    it("should return tier 0 (Hatchling) for score < 35 (all zero inputs)", async function () {
      // fused = (30*0 + 15*0 + 35*0 + 20*0)/100 = 0 → tier 0
      await adapter.connect(oracle).updateFusedScore(
        agent.address, 0, 0, 0, 0, "ipfs://proof0tierhatch1"
      );
      const rep = await adapter.getReputation(agent.address);
      expect(rep.score).to.equal(0n);
      expect(rep.tier).to.equal(0);
    });

    it("should return tier 1 (Bronze Pinch) for score = 35", async function () {
      // fused = (35*100)/100 = 35 → tier 1
      await adapter.connect(oracle).updateFusedScore(
        agent.address, 0, 0, 100, 0, "ipfs://proof1tierbronze"
      );
      const rep = await adapter.getReputation(agent.address);
      expect(rep.score).to.equal(35n);
      expect(rep.tier).to.equal(1);
    });

    it("should return tier 2 (Silver Molt) for score = 55", async function () {
      // fused = (35*100 + 20*100)/100 = 55 → tier 2
      await adapter.connect(oracle).updateFusedScore(
        agent.address, 0, 0, 100, 100, "ipfs://proof2tiersilver"
      );
      const rep = await adapter.getReputation(agent.address);
      expect(rep.score).to.equal(55n);
      expect(rep.tier).to.equal(2);
    });

    it("should return tier 3 (Gold Shell) for score = 75", async function () {
      // onChain=1000→100, perf=100, bond=50 → (30*100 + 35*100 + 20*50)/100 = 75
      await adapter.connect(oracle).updateFusedScore(
        agent.address, 1000, 0, 100, 50, "ipfs://proof3tiergoldshl"
      );
      const rep = await adapter.getReputation(agent.address);
      expect(rep.score).to.equal(75n);
      expect(rep.tier).to.equal(3);
    });

    it("should return tier 4 (Diamond Claw) for score = 100", async function () {
      // all max inputs → fused = 100 → tier 4
      await adapter.connect(oracle).updateFusedScore(
        agent.address, 1000, 10000, 100, 100, "ipfs://proof4tierdiamnd"
      );
      const rep = await adapter.getReputation(agent.address);
      expect(rep.score).to.equal(100n);
      expect(rep.tier).to.equal(4);
    });

    it("should return correct lastUpdated after updateFusedScore", async function () {
      await adapter.connect(oracle).updateFusedScore(
        agent.address, 500, 0, 50, 50, "ipfs://prooflastedupdated"
      );
      const rep = await adapter.getReputation(agent.address);
      expect(rep.lastUpdated).to.be.gt(0n);
    });

    it("should return correct validations count from submitFeedback calls", async function () {
      await adapter.connect(oracle).submitFeedback(agent.address, 50, [], "ipfs://proof1234");
      await adapter.connect(oracle).submitFeedback(agent.address, 30, [], "ipfs://proof5678");
      const rep = await adapter.getReputation(agent.address);
      expect(rep.validations).to.equal(2n);
    });
  });

  // ─── getScoreHistory ──────────────────────────────────────────────

  describe("getScoreHistory", function () {
    it("should return empty array when no history", async function () {
      const history = await adapter.getScoreHistory(agent.address, 0, 10);
      expect(history.length).to.equal(0);
    });

    it("should return correct history after updateFusedScore", async function () {
      await adapter.connect(oracle).updateFusedScore(
        agent.address, 500, 0, 50, 50, "ipfs://proof1234567890"
      );
      const history = await adapter.getScoreHistory(agent.address, 0, 10);
      expect(history.length).to.equal(1);
      expect(history[0].fusedScore).to.be.gt(0n);
    });

    it("should return empty array when offset is past the end", async function () {
      await adapter.connect(oracle).updateFusedScore(
        agent.address, 100, 0, 30, 30, "ipfs://proof1111111111"
      );
      const empty = await adapter.getScoreHistory(agent.address, 99, 5);
      expect(empty.length).to.equal(0);
    });
  });

  // ─── getFeedback ─────────────────────────────────────────────────

  describe("getFeedback", function () {
    it("should return correct feedback entry by index", async function () {
      await adapter.connect(oracle).submitFeedback(
        agent.address, 55, ["helpful"], "ipfs://proofABCDEFGH"
      );
      const fb = await adapter.getFeedback(agent.address, 0);
      expect(fb.score).to.equal(55n);
      expect(fb.tags[0]).to.equal("helpful");
    });
  });

  // ─── UpdateCooldownChanged event ──────────────────────────────────

  describe("setUpdateCooldown event", function () {
    it("should emit UpdateCooldownChanged with old and new values", async function () {
      const oldCooldown = await adapter.updateCooldown();
      await expect(adapter.connect(owner).setUpdateCooldown(120))
        .to.emit(adapter, "UpdateCooldownChanged")
        .withArgs(oldCooldown, 120n);
    });
  });

  // ─── revokeOracle ─────────────────────────────────────────────────
  // revokeOracle requires oracleCount > minOracleCount; need 2+ oracles

  describe("revokeOracle", function () {
    it("should revoke an authorized oracle when count > minOracleCount", async function () {
      await adapter.connect(owner).authorizeOracle(oracle2.address);
      await adapter.connect(owner).revokeOracle(oracle.address);
      expect(await adapter.authorizedOracles(oracle.address)).to.equal(false);
    });

    it("should prevent revoked oracle from submitting updates", async function () {
      await adapter.connect(owner).authorizeOracle(oracle2.address);
      await adapter.connect(owner).revokeOracle(oracle.address);
      await expect(
        adapter.connect(oracle).updateFusedScore(agent.address, 500, 0, 50, 50, "ipfs://proof1234567890")
      ).to.be.revertedWithCustomError(adapter, "NotAuthorizedOracle");
    });

    it("should revert InsufficientOracles when trying to drop below min", async function () {
      await expect(
        adapter.connect(owner).revokeOracle(oracle.address)
      ).to.be.revertedWithCustomError(adapter, "InsufficientOracles");
    });
  });

  // ─── verifyProof ──────────────────────────────────────────────────

  describe("verifyProof", function () {
    it("should return false before any score is set", async function () {
      expect(await adapter.verifyProof(agent.address, "ipfs://something")).to.equal(false);
    });

    it("should return true for the exact proofUri used in the last update", async function () {
      const uri = "ipfs://verifiable1234";
      await adapter.connect(oracle).updateFusedScore(agent.address, 500, 0, 50, 50, uri);
      expect(await adapter.verifyProof(agent.address, uri)).to.equal(true);
    });

    it("should return false for a different proofUri", async function () {
      await adapter.connect(oracle).updateFusedScore(
        agent.address, 500, 0, 50, 50, "ipfs://correctproof1"
      );
      expect(await adapter.verifyProof(agent.address, "ipfs://wrongproof99")).to.equal(false);
    });
  });
});
