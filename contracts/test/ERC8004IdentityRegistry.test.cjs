const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC8004IdentityRegistry", function () {
  let registry, owner, alice, bob, other;

  beforeEach(async function () {
    [owner, alice, bob, other] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("ERC8004IdentityRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();
  });

  describe("registerIdentity", function () {
    it("registers a new identity and returns tokenId via getIdentityByHandle", async function () {
      await registry.connect(alice).registerIdentity("alice", "ipfs://alice", ["dev", "audit"]);
      const [tokenId] = await registry.getIdentityByHandle("alice");
      expect(tokenId).to.equal(1);
    });

    it("reverts if already registered", async function () {
      await registry.connect(alice).registerIdentity("alice", "ipfs://alice", []);
      await expect(
        registry.connect(alice).registerIdentity("alice2", "ipfs://alice2", [])
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    });

    it("reverts if handle is taken", async function () {
      await registry.connect(alice).registerIdentity("taken", "ipfs://a", []);
      await expect(
        registry.connect(bob).registerIdentity("taken", "ipfs://b", [])
      ).to.be.revertedWithCustomError(registry, "HandleTaken");
    });
  });

  describe("getIdentity", function () {
    it("returns identity metadata", async function () {
      await registry.connect(alice).registerIdentity("alice", "ipfs://alice", ["rust", "solidity"]);
      const meta = await registry.getIdentity(1);
      expect(meta.handle).to.equal("alice");
      expect(meta.metadataUri).to.equal("ipfs://alice");
      expect(meta.skills.length).to.equal(2);
    });

    it("reverts for unknown tokenId", async function () {
      await expect(registry.getIdentity(999)).to.be.revertedWithCustomError(registry, "NotFound");
    });
  });

  describe("submitFeedback", function () {
    it("owner can submit feedback for a registered agent", async function () {
      await registry.connect(alice).registerIdentity("alice-fb", "ipfs://a", []);
      await registry.connect(owner).submitFeedback(alice.address, 10, ["quality"], "ipfs://proof");
      const count = await registry.getFeedbackCount(alice.address);
      expect(count).to.equal(1);
    });

    it("non-owner unauthorized caller cannot submit feedback", async function () {
      await registry.connect(alice).registerIdentity("alice-fb2", "ipfs://a", []);
      await expect(
        registry.connect(other).submitFeedback(alice.address, 10, [], "ipfs://proof")
      ).to.be.revertedWithCustomError(registry, "NotOwner");
    });
  });

  describe("M-07: authorizedFeedbackCallers", function () {
    it("owner can add an authorized feedback caller", async function () {
      await expect(registry.connect(owner).addFeedbackCaller(bob.address))
        .to.emit(registry, "FeedbackCallerAdded").withArgs(bob.address);
      expect(await registry.authorizedFeedbackCallers(bob.address)).to.equal(true);
    });

    it("authorized caller can submit feedback", async function () {
      await registry.connect(alice).registerIdentity("alice-m07", "ipfs://a", []);
      await registry.connect(owner).addFeedbackCaller(bob.address);
      await registry.connect(bob).submitFeedback(alice.address, 5, ["ok"], "ipfs://proof");
      const count = await registry.getFeedbackCount(alice.address);
      expect(count).to.equal(1);
      const fb = await registry.getFeedback(alice.address, 0);
      expect(fb.score).to.equal(5);
    });

    it("owner can remove an authorized feedback caller", async function () {
      await registry.connect(owner).addFeedbackCaller(bob.address);
      await expect(registry.connect(owner).removeFeedbackCaller(bob.address))
        .to.emit(registry, "FeedbackCallerRemoved").withArgs(bob.address);
      expect(await registry.authorizedFeedbackCallers(bob.address)).to.equal(false);
    });

    it("removed caller cannot submit feedback", async function () {
      await registry.connect(alice).registerIdentity("alice-m07b", "ipfs://a", []);
      await registry.connect(owner).addFeedbackCaller(bob.address);
      await registry.connect(owner).removeFeedbackCaller(bob.address);
      await expect(
        registry.connect(bob).submitFeedback(alice.address, 5, [], "ipfs://proof")
      ).to.be.revertedWithCustomError(registry, "NotOwner");
    });

    it("non-owner cannot add a feedback caller", async function () {
      await expect(
        registry.connect(other).addFeedbackCaller(bob.address)
      ).to.be.reverted;
    });
  });

  describe("getScore", function () {
    it("returns 0 for agent with no feedback", async function () {
      await registry.connect(alice).registerIdentity("alice-score", "ipfs://a", []);
      expect(await registry.getScore(alice.address)).to.equal(0);
    });

    it("accumulates scores from multiple feedbacks", async function () {
      await registry.connect(alice).registerIdentity("alice-score2", "ipfs://a", []);
      await registry.connect(owner).submitFeedback(alice.address, 10, [], "ipfs://p1");
      await registry.connect(owner).submitFeedback(alice.address, 5, [], "ipfs://p2");
      expect(await registry.getScore(alice.address)).to.equal(15);
    });
  });
});
