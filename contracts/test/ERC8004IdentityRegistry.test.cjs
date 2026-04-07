const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC8004IdentityRegistry", function () {
  let registry;
  let owner, agent1, agent2, agent3;

  beforeEach(async function () {
    [owner, agent1, agent2, agent3] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ERC8004IdentityRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();
  });

  // ─── registerIdentity ──────────────────────────────────────────────────────

  describe("registerIdentity", function () {
    it("should register a new identity and return tokenId 1", async function () {
      const tx = await registry.connect(agent1).registerIdentity(
        "jarvis",
        "ipfs://QmJarvis",
        ["nlp", "reasoning"]
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (l) => l.fragment && l.fragment.name === "IdentityRegistered"
      );
      expect(event).to.not.be.undefined;
      expect(event.args.tokenId).to.equal(1n);
      expect(event.args.owner).to.equal(agent1.address);
      expect(event.args.handle).to.equal("jarvis");
    });

    it("should auto-increment tokenIds", async function () {
      await registry.connect(agent1).registerIdentity("agent1", "ipfs://1", []);
      await registry.connect(agent2).registerIdentity("agent2", "ipfs://2", []);
      const meta2 = await registry.getIdentityByHandle("agent2");
      expect(meta2.tokenId).to.equal(2n);
    });

    it("should revert AlreadyRegistered on duplicate address", async function () {
      await registry.connect(agent1).registerIdentity("first", "ipfs://a", []);
      await expect(
        registry.connect(agent1).registerIdentity("second", "ipfs://b", [])
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    });

    it("should revert HandleTaken on duplicate handle", async function () {
      await registry.connect(agent1).registerIdentity("samehandle", "ipfs://a", []);
      await expect(
        registry.connect(agent2).registerIdentity("samehandle", "ipfs://b", [])
      ).to.be.revertedWithCustomError(registry, "HandleTaken");
    });

    it("should store skills array correctly", async function () {
      await registry.connect(agent1).registerIdentity(
        "multiSkill",
        "ipfs://multi",
        ["code", "audit", "defi"]
      );
      const meta = await registry.getIdentity(1);
      expect(meta.skills.length).to.equal(3);
      expect(meta.skills[0]).to.equal("code");
      expect(meta.skills[2]).to.equal("defi");
    });

    it("should store an empty skills array", async function () {
      await registry.connect(agent1).registerIdentity("noSkills", "ipfs://x", []);
      const meta = await registry.getIdentity(1);
      expect(meta.skills.length).to.equal(0);
    });

    it("should mark agent as registered after call", async function () {
      expect(await registry.isRegistered(agent1.address)).to.be.false;
      await registry.connect(agent1).registerIdentity("reg", "ipfs://r", []);
      expect(await registry.isRegistered(agent1.address)).to.be.true;
    });
  });

  // ─── getIdentity ───────────────────────────────────────────────────────────

  describe("getIdentity", function () {
    it("should return correct metadata for valid tokenId", async function () {
      await registry.connect(agent1).registerIdentity("myAgent", "ipfs://meta", ["skill1"]);
      const meta = await registry.getIdentity(1);
      expect(meta.handle).to.equal("myAgent");
      expect(meta.metadataUri).to.equal("ipfs://meta");
      expect(meta.registeredAt).to.be.gt(0n);
    });

    it("should revert NotFound for nonexistent tokenId", async function () {
      await expect(
        registry.getIdentity(999)
      ).to.be.revertedWithCustomError(registry, "NotFound");
    });

    it("should revert NotFound for tokenId 0", async function () {
      await expect(
        registry.getIdentity(0)
      ).to.be.revertedWithCustomError(registry, "NotFound");
    });
  });

  // ─── getIdentityByHandle ───────────────────────────────────────────────────

  describe("getIdentityByHandle", function () {
    it("should return tokenId and metadata for known handle", async function () {
      await registry.connect(agent1).registerIdentity("lookup", "ipfs://lu", []);
      const [tokenId, meta] = await registry.getIdentityByHandle("lookup");
      expect(tokenId).to.equal(1n);
      expect(meta.handle).to.equal("lookup");
    });

    it("should revert NotFound for unknown handle", async function () {
      await expect(
        registry.getIdentityByHandle("ghost")
      ).to.be.revertedWithCustomError(registry, "NotFound");
    });
  });

  // ─── ownerOfIdentity ───────────────────────────────────────────────────────

  describe("ownerOfIdentity", function () {
    it("should return correct owner address", async function () {
      await registry.connect(agent2).registerIdentity("ownedBy2", "ipfs://o2", []);
      expect(await registry.ownerOfIdentity(1)).to.equal(agent2.address);
    });

    it("should revert NotFound for nonexistent tokenId", async function () {
      await expect(
        registry.ownerOfIdentity(999)
      ).to.be.revertedWithCustomError(registry, "NotFound");
    });
  });

  // ─── updateMetadata ────────────────────────────────────────────────────────

  describe("updateMetadata", function () {
    beforeEach(async function () {
      await registry.connect(agent1).registerIdentity("updater", "ipfs://old", []);
    });

    it("should allow owner to update metadataUri", async function () {
      await registry.connect(agent1).updateMetadata(1, "ipfs://new");
      const meta = await registry.getIdentity(1);
      expect(meta.metadataUri).to.equal("ipfs://new");
    });

    it("should emit MetadataUpdated event", async function () {
      await expect(registry.connect(agent1).updateMetadata(1, "ipfs://updated"))
        .to.emit(registry, "MetadataUpdated")
        .withArgs(1n, "ipfs://updated");
    });

    it("should revert NotOwner when called by non-owner of token", async function () {
      await expect(
        registry.connect(agent2).updateMetadata(1, "ipfs://hack")
      ).to.be.revertedWithCustomError(registry, "NotOwner");
    });

    it("should not allow contract owner to update other agent metadata", async function () {
      await expect(
        registry.connect(owner).updateMetadata(1, "ipfs://ownerHack")
      ).to.be.revertedWithCustomError(registry, "NotOwner");
    });
  });

  // ─── isRegistered ──────────────────────────────────────────────────────────

  describe("isRegistered", function () {
    it("should return false for unregistered address", async function () {
      expect(await registry.isRegistered(agent3.address)).to.be.false;
    });

    it("should return true after registration", async function () {
      await registry.connect(agent3).registerIdentity("a3", "ipfs://a3", []);
      expect(await registry.isRegistered(agent3.address)).to.be.true;
    });
  });

  // ─── submitFeedback ────────────────────────────────────────────────────────

  describe("submitFeedback", function () {
    it("should allow owner to submit positive feedback", async function () {
      await registry.connect(owner).submitFeedback(
        agent1.address, 100, ["quality", "speed"], "ipfs://proof1"
      );
      expect(await registry.getScore(agent1.address)).to.equal(100n);
    });

    it("should allow negative feedback and decrease score", async function () {
      await registry.connect(owner).submitFeedback(agent1.address, 500, [], "ipfs://pos");
      await registry.connect(owner).submitFeedback(agent1.address, -200, ["slow"], "ipfs://neg");
      expect(await registry.getScore(agent1.address)).to.equal(300n);
    });

    it("should emit FeedbackSubmitted and ScoreUpdated events", async function () {
      await expect(
        registry.connect(owner).submitFeedback(agent1.address, 50, ["good"], "ipfs://ev")
      )
        .to.emit(registry, "FeedbackSubmitted")
        .to.emit(registry, "ScoreUpdated")
        .withArgs(agent1.address, 50n);
    });

    it("should cap score at +10000", async function () {
      await registry.connect(owner).submitFeedback(agent1.address, 9000, [], "ipfs://hi");
      await registry.connect(owner).submitFeedback(agent1.address, 5000, [], "ipfs://hi2");
      expect(await registry.getScore(agent1.address)).to.equal(10000n);
    });

    it("should cap score at -10000", async function () {
      await registry.connect(owner).submitFeedback(agent1.address, -9000, [], "ipfs://lo");
      await registry.connect(owner).submitFeedback(agent1.address, -5000, [], "ipfs://lo2");
      expect(await registry.getScore(agent1.address)).to.equal(-10000n);
    });

    it("should revert when called by non-owner", async function () {
      await expect(
        registry.connect(agent1).submitFeedback(agent2.address, 10, [], "ipfs://hack")
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("should increment feedback count after submission", async function () {
      await registry.connect(owner).submitFeedback(agent1.address, 10, [], "ipfs://1");
      await registry.connect(owner).submitFeedback(agent1.address, 20, [], "ipfs://2");
      expect(await registry.getFeedbackCount(agent1.address)).to.equal(2n);
    });

    it("should store multiple feedback entries independently", async function () {
      await registry.connect(owner).submitFeedback(agent1.address, 10, ["tag1"], "ipfs://f1");
      await registry.connect(owner).submitFeedback(agent1.address, -5, ["tag2"], "ipfs://f2");
      const f0 = await registry.getFeedback(agent1.address, 0);
      const f1 = await registry.getFeedback(agent1.address, 1);
      expect(f0.score).to.equal(10n);
      expect(f1.score).to.equal(-5n);
      expect(f0.proofUri).to.equal("ipfs://f1");
      expect(f1.tags[0]).to.equal("tag2");
    });
  });

  // ─── getFeedbackCount / getFeedback ────────────────────────────────────────

  describe("getFeedbackCount", function () {
    it("should return 0 for agent with no feedback", async function () {
      expect(await registry.getFeedbackCount(agent1.address)).to.equal(0n);
    });
  });

  describe("getFeedback", function () {
    it("should revert IndexOutOfBounds for empty feedback list", async function () {
      await expect(
        registry.getFeedback(agent1.address, 0)
      ).to.be.revertedWithCustomError(registry, "IndexOutOfBounds");
    });

    it("should revert IndexOutOfBounds for index past end", async function () {
      await registry.connect(owner).submitFeedback(agent1.address, 10, [], "ipfs://x");
      await expect(
        registry.getFeedback(agent1.address, 1)
      ).to.be.revertedWithCustomError(registry, "IndexOutOfBounds");
    });

    it("should return correct feedback at valid index", async function () {
      await registry.connect(owner).submitFeedback(
        agent1.address, 42, ["performance"], "ipfs://check"
      );
      const fb = await registry.getFeedback(agent1.address, 0);
      expect(fb.from).to.equal(owner.address);
      expect(fb.to).to.equal(agent1.address);
      expect(fb.score).to.equal(42n);
      expect(fb.tags[0]).to.equal("performance");
      expect(fb.proofUri).to.equal("ipfs://check");
      expect(fb.timestamp).to.be.gt(0n);
    });
  });

  // ─── getScore ──────────────────────────────────────────────────────────────

  describe("getScore", function () {
    it("should return 0 for agent with no feedback", async function () {
      expect(await registry.getScore(agent1.address)).to.equal(0n);
    });

    it("should reflect cumulative score correctly", async function () {
      await registry.connect(owner).submitFeedback(agent1.address, 300, [], "ipfs://a");
      await registry.connect(owner).submitFeedback(agent1.address, -100, [], "ipfs://b");
      await registry.connect(owner).submitFeedback(agent1.address, 50, [], "ipfs://c");
      expect(await registry.getScore(agent1.address)).to.equal(250n);
    });
  });

  // ─── ownership ─────────────────────────────────────────────────────────────

  describe("ownership", function () {
    it("should deploy with deployer as owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("should support Ownable2Step transfer flow", async function () {
      await registry.connect(owner).transferOwnership(agent1.address);
      expect(await registry.pendingOwner()).to.equal(agent1.address);
      await registry.connect(agent1).acceptOwnership();
      expect(await registry.owner()).to.equal(agent1.address);
    });
  });
});
