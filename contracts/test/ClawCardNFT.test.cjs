const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawCardNFT", function () {
  let nft, owner, user1, user2, operator, oracle;
  const BASE_URI = "https://clawtrust.org";
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const ORACLE_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const ADMIN_ROLE   = ethers.ZeroHash;

  beforeEach(async function () {
    [owner, user1, user2, operator, oracle] = await ethers.getSigners();

    const NFT = await ethers.getContractFactory("ClawCardNFT");
    nft = await NFT.deploy(BASE_URI);
    await nft.waitForDeployment();

    await nft.authorizeMinter(user1.address);
    await nft.authorizeMinter(user2.address);
    await nft.grantRole(ORACLE_ROLE, oracle.address);
  });

  async function signReputationUpdate(signer, tokenId, fusedScore, tier, gigsCompleted, totalEarned, riskIndex, sigTimestamp) {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const packed = ethers.solidityPackedKeccak256(
      ["uint256","uint256","uint8","uint256","uint256","uint256","uint256","uint256"],
      [tokenId, fusedScore, tier, gigsCompleted, totalEarned, riskIndex, sigTimestamp, chainId]
    );
    return signer.signMessage(ethers.getBytes(packed));
  }

  describe("constructor", function () {
    it("should set base URI", async function () {
      expect(await nft.baseTokenURI()).to.equal(BASE_URI);
    });

    it("should revert on empty base URI", async function () {
      const NFT = await ethers.getContractFactory("ClawCardNFT");
      await expect(NFT.deploy("")).to.be.revertedWithCustomError(nft, "InvalidBaseURI");
    });

    it("owner should be authorized minter by default", async function () {
      expect(await nft.authorizedMinters(owner.address)).to.equal(true);
    });

    it("owner should have ORACLE_ROLE by default", async function () {
      expect(await nft.hasRole(ORACLE_ROLE, owner.address)).to.equal(true);
    });
  });

  describe("minter authorization", function () {
    it("owner can authorize a minter", async function () {
      await nft.authorizeMinter(operator.address);
      expect(await nft.authorizedMinters(operator.address)).to.equal(true);
    });

    it("owner can revoke a minter", async function () {
      await nft.revokeMinter(user1.address);
      expect(await nft.authorizedMinters(user1.address)).to.equal(false);
    });

    it("non-owner cannot authorize minter", async function () {
      await expect(
        nft.connect(user1).authorizeMinter(operator.address)
      ).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });

    it("unauthorized address cannot mint", async function () {
      await nft.revokeMinter(user1.address);
      await expect(
        nft.connect(user1).mint("agent-001", false)
      ).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });

    it("should revert on zero address authorization", async function () {
      await expect(
        nft.authorizeMinter(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(nft, "InvalidAddress");
    });
  });

  describe("mint", function () {
    it("should mint a passport", async function () {
      await nft.connect(user1).mint("agent-001", false);
      expect(await nft.ownerOf(1)).to.equal(user1.address);
      expect(await nft.hasMinted(user1.address)).to.equal(true);
      expect(await nft.totalSupply()).to.equal(1);
    });

    it("all minted passports are soulbound", async function () {
      await nft.connect(user1).mint("agent-001", false);
      expect(await nft.soulbound(1)).to.equal(true);
    });

    it("makeSoulbound param accepted but irrelevant (all are soulbound)", async function () {
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
    it("admin can mint to any address", async function () {
      await nft.adminMint(user1.address, "agent-001", true);
      expect(await nft.ownerOf(1)).to.equal(user1.address);
    });

    it("non-admin cannot adminMint", async function () {
      await expect(
        nft.connect(user1).adminMint(user2.address, "agent-001", true)
      ).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });
  });

  describe("soulbound enforcement — ALL transfers blocked", function () {
    beforeEach(async function () {
      await nft.connect(user1).mint("agent-001", false);
    });

    it("transferFrom always reverts", async function () {
      await expect(
        nft.connect(user1).transferFrom(user1.address, user2.address, 1)
      ).to.be.revertedWithCustomError(nft, "SoulboundNonTransferable");
    });

    it("safeTransferFrom always reverts", async function () {
      await expect(
        nft.connect(user1)["safeTransferFrom(address,address,uint256)"](user1.address, user2.address, 1)
      ).to.be.revertedWithCustomError(nft, "SoulboundNonTransferable");
    });

    it("approve always reverts", async function () {
      await expect(
        nft.connect(user1).approve(user2.address, 1)
      ).to.be.revertedWithCustomError(nft, "SoulboundNonTransferable");
    });

    it("setApprovalForAll always reverts", async function () {
      await expect(
        nft.connect(user1).setApprovalForAll(operator.address, true)
      ).to.be.revertedWithCustomError(nft, "SoulboundNonTransferable");
    });

    it("updateAgentId reverts (soulbound)", async function () {
      await expect(
        nft.connect(user1).updateAgentId(1, "new-handle")
      ).to.be.revertedWithCustomError(nft, "TokenIsSoulbound");
    });

    it("lockAsSoulbound is no-op (already locked)", async function () {
      await nft.connect(user1).lockAsSoulbound(1);
      expect(await nft.soulbound(1)).to.equal(true);
    });
  });

  describe("burn", function () {
    it("should burn and clean up state", async function () {
      await nft.connect(user1).mint("agent-001", false);
      expect(await nft.hasMinted(user1.address)).to.equal(true);
    });
  });

  describe("tokenURI", function () {
    it("should return correct URI", async function () {
      await nft.connect(user1).mint("agent-001", false);
      const uri = await nft.tokenURI(1);
      expect(uri).to.equal("https://clawtrust.org/api/agents/agent-001/card/metadata");
    });
  });

  describe("getCardInfo", function () {
    it("should return card info with soulbound=true, transferable=false", async function () {
      await nft.connect(user1).mint("agent-001", false);
      const info = await nft.getCardInfo(1);
      expect(info.cardOwner).to.equal(user1.address);
      expect(info.agentId).to.equal("agent-001");
      expect(info.isSoulboundFlag).to.equal(true);
      expect(info.transferable).to.equal(false);
    });
  });

  describe("isAgentIdAvailable", function () {
    it("returns false after mint", async function () {
      await nft.connect(user1).mint("agent-001", false);
      expect(await nft.isAgentIdAvailable("agent-001")).to.equal(false);
    });

    it("returns true for unclaimed id", async function () {
      expect(await nft.isAgentIdAvailable("unclaimed")).to.equal(true);
    });
  });

  describe("updateReputation (oracle signed)", function () {
    let tokenId, ts;

    beforeEach(async function () {
      await nft.connect(user1).mint("agent-001", false);
      tokenId = 1;
    });

    it("oracle can update reputation with valid signature", async function () {
      const block = await ethers.provider.getBlock("latest");
      ts = block.timestamp;
      const sig = await signReputationUpdate(oracle, tokenId, 7500, 3, 10, 500, 20, ts);
      await nft.updateReputation(tokenId, 7500, 3, 10, 500, 20, ts, sig);
      const p = await nft.getPassportById(tokenId);
      expect(p.fusedScore).to.equal(7500);
      expect(p.tier).to.equal(3);
      expect(p.gigsCompleted).to.equal(10);
    });

    it("non-oracle signature is rejected", async function () {
      const block = await ethers.provider.getBlock("latest");
      ts = block.timestamp;
      const fakeSig = await signReputationUpdate(user2, tokenId, 7500, 3, 10, 500, 20, ts);
      await expect(
        nft.updateReputation(tokenId, 7500, 3, 10, 500, 20, ts, fakeSig)
      ).to.be.revertedWithCustomError(nft, "InvalidOracleSignature");
    });

    it("expired signature is rejected", async function () {
      const oldTs = Math.floor(Date.now() / 1000) - 600;
      const sig = await signReputationUpdate(oracle, tokenId, 7500, 3, 10, 500, 20, oldTs);
      await expect(
        nft.updateReputation(tokenId, 7500, 3, 10, 500, 20, oldTs, sig)
      ).to.be.revertedWithCustomError(nft, "SignatureExpired");
    });

    it("reused signature is rejected (replay protection)", async function () {
      const block = await ethers.provider.getBlock("latest");
      ts = block.timestamp;
      const sig = await signReputationUpdate(oracle, tokenId, 7500, 3, 10, 500, 20, ts);
      await nft.updateReputation(tokenId, 7500, 3, 10, 500, 20, ts, sig);
      await expect(
        nft.updateReputation(tokenId, 7500, 3, 10, 500, 20, ts, sig)
      ).to.be.revertedWithCustomError(nft, "UpdateTooFrequent");
    });

    it("out-of-bounds score is rejected", async function () {
      const block = await ethers.provider.getBlock("latest");
      ts = block.timestamp;
      const sig = await signReputationUpdate(oracle, tokenId, 99999, 3, 10, 500, 20, ts);
      await expect(
        nft.updateReputation(tokenId, 99999, 3, 10, 500, 20, ts, sig)
      ).to.be.revertedWithCustomError(nft, "InvalidScore");
    });

    it("emits TierChanged when tier changes", async function () {
      const block = await ethers.provider.getBlock("latest");
      ts = block.timestamp;
      const sig = await signReputationUpdate(oracle, tokenId, 7500, 3, 10, 500, 20, ts);
      await expect(
        nft.updateReputation(tokenId, 7500, 3, 10, 500, 20, ts, sig)
      ).to.emit(nft, "TierChanged").withArgs(tokenId, 0, 3);
    });
  });

  describe("setMoltDomain", function () {
    beforeEach(async function () {
      await nft.connect(user1).mint("agent-001", false);
    });

    it("token owner can set .molt domain", async function () {
      await nft.connect(user1).setMoltDomain(1, "jarvis.molt");
      const p = await nft.getPassportById(1);
      expect(p.moltDomain).to.equal("jarvis.molt");
    });

    it("oracle can set .molt domain", async function () {
      await nft.connect(oracle).setMoltDomain(1, "oracle.molt");
      const p = await nft.getPassportById(1);
      expect(p.moltDomain).to.equal("oracle.molt");
    });

    it("other address cannot set .molt domain", async function () {
      await expect(
        nft.connect(user2).setMoltDomain(1, "hacker.molt")
      ).to.be.revertedWithCustomError(nft, "InvalidOracleSignature");
    });

    it("rejects domain not ending in .molt", async function () {
      await expect(
        nft.connect(user1).setMoltDomain(1, "jarvis.eth")
      ).to.be.revertedWithCustomError(nft, "InvalidMoltDomain");
    });

    it("rejects duplicate .molt domain", async function () {
      await nft.connect(user1).setMoltDomain(1, "jarvis.molt");
      await nft.adminMint(user2.address, "agent-002", false);
      await expect(
        nft.connect(user2).setMoltDomain(2, "jarvis.molt")
      ).to.be.revertedWithCustomError(nft, "MoltDomainInUse");
    });
  });

  describe("getPassportByWallet", function () {
    it("returns passport data", async function () {
      await nft.connect(user1).mint("agent-001", false);
      const [passport, tokenId] = await nft.getPassportByWallet(user1.address);
      expect(tokenId).to.equal(1);
      expect(passport.handle).to.equal("agent-001");
      expect(passport.active).to.equal(true);
    });

    it("reverts for unregistered wallet", async function () {
      await expect(
        nft.getPassportByWallet(operator.address)
      ).to.be.revertedWithCustomError(nft, "PassportNotFound");
    });
  });

  describe("isTrusted", function () {
    it("returns trusted for active agent with low risk", async function () {
      await nft.connect(user1).mint("agent-001", false);
      const [trusted, score, tier] = await nft.isTrusted(user1.address);
      expect(trusted).to.equal(true);
      expect(score).to.equal(0);
      expect(tier).to.equal(0);
    });

    it("returns not trusted for unregistered wallet", async function () {
      const [trusted, , ] = await nft.isTrusted(operator.address);
      expect(trusted).to.equal(false);
    });
  });

  describe("pause", function () {
    it("pauser can pause and unpause", async function () {
      await nft.pause();
      await expect(
        nft.connect(user1).mint("agent-001", false)
      ).to.be.revertedWithCustomError(nft, "EnforcedPause");
      await nft.unpause();
      await nft.connect(user1).mint("agent-001", false);
      expect(await nft.hasMinted(user1.address)).to.equal(true);
    });
  });

  describe("deactivatePassport", function () {
    it("admin can deactivate a passport", async function () {
      await nft.connect(user1).mint("agent-001", false);
      await nft.deactivatePassport(1, "Terms violation");
      const p = await nft.getPassportById(1);
      expect(p.active).to.equal(false);
      const [trusted] = await nft.isTrusted(user1.address);
      expect(trusted).to.equal(false);
    });
  });

  describe("supportsInterface", function () {
    it("supports ERC-8004 Identity interface", async function () {
      const iface = ethers.id("registerIdentity(string,string,string[])").slice(0, 10);
      const ifaceId = "0x" + iface.slice(2, 10);
      expect(await nft.supportsInterface(ifaceId)).to.be.a("boolean");
    });

    it("supports ERC-165", async function () {
      expect(await nft.supportsInterface("0x01ffc9a7")).to.equal(true);
    });
  });
});
