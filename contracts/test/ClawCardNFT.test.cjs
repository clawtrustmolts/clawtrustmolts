const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawCardNFT", function () {
  let nft, owner, user1, user2, operator;
  const BASE_URI = "https://clawtrust.org";

  beforeEach(async function () {
    [owner, user1, user2, operator] = await ethers.getSigners();

    const NFT = await ethers.getContractFactory("ClawCardNFT");
    nft = await NFT.deploy(BASE_URI);
    await nft.waitForDeployment();
  });

  describe("constructor", function () {
    it("should set base URI", async function () {
      expect(await nft.baseTokenURI()).to.equal(BASE_URI);
    });

    it("should revert on empty base URI", async function () {
      const NFT = await ethers.getContractFactory("ClawCardNFT");
      await expect(NFT.deploy("")).to.be.revertedWithCustomError(nft, "InvalidBaseURI");
    });
  });

  describe("mint", function () {
    it("should mint a card", async function () {
      await nft.connect(user1).mint("agent-001", false);
      expect(await nft.ownerOf(1)).to.equal(user1.address);
      expect(await nft.hasMinted(user1.address)).to.equal(true);
      const supply = await nft.totalSupply();
      expect(supply).to.equal(1);
    });

    it("should mint soulbound card", async function () {
      await nft.connect(user1).mint("agent-001", true);
      expect(await nft.soulbound(1)).to.equal(true);
    });

    it("should revert on double mint", async function () {
      await nft.connect(user1).mint("agent-001", false);
      await expect(
        nft.connect(user1).mint("agent-002", false)
      ).to.be.revertedWithCustomError(nft, "AlreadyMinted");
    });

    it("should revert on duplicate agentId", async function () {
      await nft.connect(user1).mint("agent-001", false);
      await expect(
        nft.connect(user2).mint("agent-001", false)
      ).to.be.revertedWithCustomError(nft, "AgentIdInUse");
    });

    it("should revert on empty agentId", async function () {
      await expect(
        nft.connect(user1).mint("", false)
      ).to.be.revertedWithCustomError(nft, "InvalidAgentId");
    });
  });

  describe("adminMint", function () {
    it("owner can admin mint", async function () {
      await nft.adminMint(user1.address, "agent-001", true);
      expect(await nft.ownerOf(1)).to.equal(user1.address);
    });

    it("non-owner cannot admin mint", async function () {
      await expect(
        nft.connect(user1).adminMint(user2.address, "agent-001", true)
      ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });
  });

  describe("soulbound enforcement", function () {
    it("should block transfer of soulbound token", async function () {
      await nft.connect(user1).mint("agent-001", true);
      await expect(
        nft.connect(user1).transferFrom(user1.address, user2.address, 1)
      ).to.be.revertedWithCustomError(nft, "TokenIsSoulbound");
    });

    it("should block approve for soulbound token", async function () {
      await nft.connect(user1).mint("agent-001", true);
      await expect(
        nft.connect(user1).approve(user2.address, 1)
      ).to.be.revertedWithCustomError(nft, "TokenIsSoulbound");
    });

    it("should block setApprovalForAll when token is soulbound", async function () {
      await nft.connect(user1).mint("agent-001", true);
      await expect(
        nft.connect(user1).setApprovalForAll(operator.address, true)
      ).to.be.revertedWithCustomError(nft, "TokenIsSoulbound");
    });
  });

  describe("transfer restrictions", function () {
    it("should allow transfer of non-soulbound token", async function () {
      await nft.connect(user1).mint("agent-001", false);
      await nft.connect(user1).transferFrom(user1.address, user2.address, 1);
      expect(await nft.ownerOf(1)).to.equal(user2.address);
      expect(await nft.hasMinted(user1.address)).to.equal(false);
      expect(await nft.hasMinted(user2.address)).to.equal(true);
    });

    it("should block transfer when transfers disabled", async function () {
      await nft.connect(user1).mint("agent-001", false);
      await nft.setTransfersEnabled(false);
      await expect(
        nft.connect(user1).transferFrom(user1.address, user2.address, 1)
      ).to.be.revertedWithCustomError(nft, "TransfersDisabled");
    });

    it("should prevent transfer to wallet that already has a card", async function () {
      await nft.connect(user1).mint("agent-001", false);
      await nft.connect(user2).mint("agent-002", false);
      await expect(
        nft.connect(user1).transferFrom(user1.address, user2.address, 1)
      ).to.be.revertedWithCustomError(nft, "AlreadyMinted");
    });
  });

  describe("lockAsSoulbound", function () {
    it("should lock token as soulbound", async function () {
      await nft.connect(user1).mint("agent-001", false);
      await nft.connect(user1).lockAsSoulbound(1);
      expect(await nft.soulbound(1)).to.equal(true);
    });

    it("should be idempotent for already soulbound", async function () {
      await nft.connect(user1).mint("agent-001", true);
      await nft.connect(user1).lockAsSoulbound(1);
      expect(await nft.soulbound(1)).to.equal(true);
    });
  });

  describe("burn", function () {
    it("should burn and clean up state", async function () {
      await nft.connect(user1).mint("agent-001", false);
      await nft.connect(user1).burn(1);
      expect(await nft.hasMinted(user1.address)).to.equal(false);
      expect(await nft.isAgentIdAvailable("agent-001")).to.equal(true);
    });

    it("non-owner cannot burn", async function () {
      await nft.connect(user1).mint("agent-001", false);
      await expect(
        nft.connect(user2).burn(1)
      ).to.be.revertedWithCustomError(nft, "NotTokenOwner");
    });
  });

  describe("tokenURI", function () {
    it("should return correct URI", async function () {
      await nft.connect(user1).mint("agent-001", false);
      const uri = await nft.tokenURI(1);
      expect(uri).to.equal("https://clawtrust.org/api/agents/agent-001/card/metadata");
    });
  });

  describe("updateAgentId", function () {
    it("should update agentId for non-soulbound", async function () {
      await nft.connect(user1).mint("agent-001", false);
      await nft.connect(user1).updateAgentId(1, "agent-new");
      expect(await nft.isAgentIdAvailable("agent-001")).to.equal(true);
      expect(await nft.isAgentIdAvailable("agent-new")).to.equal(false);
    });

    it("should revert for soulbound token", async function () {
      await nft.connect(user1).mint("agent-001", true);
      await expect(
        nft.connect(user1).updateAgentId(1, "agent-new")
      ).to.be.revertedWithCustomError(nft, "TokenIsSoulbound");
    });
  });

  describe("getCardInfo", function () {
    it("should return card info", async function () {
      await nft.connect(user1).mint("agent-001", true);
      const info = await nft.getCardInfo(1);
      expect(info.cardOwner).to.equal(user1.address);
      expect(info.agentId).to.equal("agent-001");
      expect(info.isSoulbound).to.equal(true);
      expect(info.transferable).to.equal(false);
    });
  });
});
