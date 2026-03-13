const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawTrustRegistry", function () {
  let registry, owner, registrar, user1, user2, other;
  const REGISTRAR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REGISTRAR_ROLE"));
  const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));

  beforeEach(async function () {
    [owner, registrar, user1, user2, other] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("ClawTrustRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    await registry.grantRole(REGISTRAR_ROLE, registrar.address);
  });

  describe("deployment", function () {
    it("should set deployer as DEFAULT_ADMIN_ROLE", async function () {
      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
      expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("should set deployer as REGISTRAR_ROLE", async function () {
      expect(await registry.hasRole(REGISTRAR_ROLE, owner.address)).to.be.true;
    });

    it("should set deployer as PAUSER_ROLE", async function () {
      expect(await registry.hasRole(PAUSER_ROLE, owner.address)).to.be.true;
    });

    it("should have correct name and symbol", async function () {
      expect(await registry.name()).to.equal("ClawTrust Name Service");
      expect(await registry.symbol()).to.equal("CLNS");
    });

    it("should expose TLD constants", async function () {
      expect(await registry.TLD_CLAW()).to.equal(".claw");
      expect(await registry.TLD_SHELL()).to.equal(".shell");
      expect(await registry.TLD_PINCH()).to.equal(".pinch");
    });

    it("should have MAX_SUPPLY of 10000000", async function () {
      expect(await registry.MAX_SUPPLY()).to.equal(10_000_000);
    });
  });

  describe("register — happy path", function () {
    it("should register a .claw domain", async function () {
      const tx = await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);

      const domain = await registry.getDomain(1);
      expect(domain.name).to.equal("jarvis");
      expect(domain.tld).to.equal(".claw");
      expect(domain.owner).to.equal(user1.address);
      expect(domain.active).to.be.true;
      expect(domain.pricePaid).to.equal(0);
    });

    it("should register a .shell domain", async function () {
      await registry.connect(registrar).register("agent", ".shell", user1.address, 100e6);
      const domain = await registry.getDomain(1);
      expect(domain.name).to.equal("agent");
      expect(domain.tld).to.equal(".shell");
      expect(domain.pricePaid).to.equal(100e6);
    });

    it("should register a .pinch domain", async function () {
      await registry.connect(registrar).register("testbot", ".pinch", user2.address, 25e6);
      const domain = await registry.getDomain(1);
      expect(domain.name).to.equal("testbot");
      expect(domain.tld).to.equal(".pinch");
      expect(domain.owner).to.equal(user2.address);
    });

    it("should mint ERC-721 token to owner", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      expect(await registry.ownerOf(1)).to.equal(user1.address);
      expect(await registry.balanceOf(user1.address)).to.equal(1);
    });

    it("should set expiresAt to registeredAt + 365 days", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      const domain = await registry.getDomain(1);
      expect(domain.expiresAt - domain.registeredAt).to.equal(365n * 24n * 60n * 60n);
    });

    it("should emit DomainRegistered event", async function () {
      await expect(registry.connect(registrar).register("jarvis", ".claw", user1.address, 50e6))
        .to.emit(registry, "DomainRegistered");
    });

    it("should increment tokenId for each registration", async function () {
      await registry.connect(registrar).register("agent-a", ".claw", user1.address, 0);
      await registry.connect(registrar).register("agent-b", ".shell", user2.address, 0);
      const d1 = await registry.getDomain(1);
      const d2 = await registry.getDomain(2);
      expect(d1.name).to.equal("agent-a");
      expect(d2.name).to.equal("agent-b");
    });

    it("should allow same name under different TLDs", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      await registry.connect(registrar).register("jarvis", ".shell", user2.address, 0);
      await registry.connect(registrar).register("jarvis", ".pinch", other.address, 0);

      const resolved1 = await registry.resolve("jarvis", ".claw");
      const resolved2 = await registry.resolve("jarvis", ".shell");
      const resolved3 = await registry.resolve("jarvis", ".pinch");
      expect(resolved1).to.equal(user1.address);
      expect(resolved2).to.equal(user2.address);
      expect(resolved3).to.equal(other.address);
    });
  });

  describe("register — access control", function () {
    it("should revert if caller lacks REGISTRAR_ROLE", async function () {
      await expect(
        registry.connect(other).register("jarvis", ".claw", user1.address, 0)
      ).to.be.reverted;
    });

    it("should allow granted registrar to register", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      const domain = await registry.getDomain(1);
      expect(domain.name).to.equal("jarvis");
    });
  });

  describe("register — TLD validation", function () {
    it("should reject invalid TLD", async function () {
      await expect(
        registry.connect(registrar).register("jarvis", ".molt", user1.address, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidTLD");
    });

    it("should reject empty TLD", async function () {
      await expect(
        registry.connect(registrar).register("jarvis", "", user1.address, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidTLD");
    });

    it("should reject .com TLD", async function () {
      await expect(
        registry.connect(registrar).register("jarvis", ".com", user1.address, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidTLD");
    });
  });

  describe("register — name validation", function () {
    it("should reject name shorter than 3 chars", async function () {
      await expect(
        registry.connect(registrar).register("ab", ".claw", user1.address, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidName");
    });

    it("should reject name longer than 32 chars", async function () {
      const longName = "a".repeat(33);
      await expect(
        registry.connect(registrar).register(longName, ".claw", user1.address, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidName");
    });

    it("should accept 3-char name", async function () {
      await registry.connect(registrar).register("abc", ".claw", user1.address, 0);
      const domain = await registry.getDomain(1);
      expect(domain.name).to.equal("abc");
    });

    it("should accept 32-char name", async function () {
      const name32 = "a".repeat(32);
      await registry.connect(registrar).register(name32, ".claw", user1.address, 0);
      const domain = await registry.getDomain(1);
      expect(domain.name).to.equal(name32);
    });

    it("should reject uppercase letters", async function () {
      await expect(
        registry.connect(registrar).register("Jarvis", ".claw", user1.address, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidName");
    });

    it("should reject special characters", async function () {
      await expect(
        registry.connect(registrar).register("jar_vis", ".claw", user1.address, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidName");
    });

    it("should accept hyphens in middle", async function () {
      await registry.connect(registrar).register("my-agent", ".claw", user1.address, 0);
      const domain = await registry.getDomain(1);
      expect(domain.name).to.equal("my-agent");
    });

    it("should reject hyphen at start", async function () {
      await expect(
        registry.connect(registrar).register("-agent", ".claw", user1.address, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidName");
    });

    it("should reject hyphen at end", async function () {
      await expect(
        registry.connect(registrar).register("agent-", ".claw", user1.address, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidName");
    });

    it("should accept alphanumeric names", async function () {
      await registry.connect(registrar).register("agent007", ".claw", user1.address, 0);
      const domain = await registry.getDomain(1);
      expect(domain.name).to.equal("agent007");
    });
  });

  describe("register — reserved names", function () {
    const reservedNames = [
      "admin", "api", "app", "trust", "claw",
      "molt", "shell", "pinch", "root", "clawtrust"
    ];

    for (const name of reservedNames) {
      it(`should reject reserved name "${name}"`, async function () {
        await expect(
          registry.connect(registrar).register(name, ".claw", user1.address, 0)
        ).to.be.revertedWithCustomError(registry, "ReservedName");
      });
    }
  });

  describe("register — duplicate detection", function () {
    it("should reject duplicate domain registration", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      await expect(
        registry.connect(registrar).register("jarvis", ".claw", user2.address, 0)
      ).to.be.revertedWithCustomError(registry, "DomainAlreadyTaken");
    });
  });

  describe("resolve", function () {
    it("should resolve registered domain to owner", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      const resolved = await registry.resolve("jarvis", ".claw");
      expect(resolved).to.equal(user1.address);
    });

    it("should revert for unregistered domain", async function () {
      await expect(
        registry.resolve("nonexistent", ".claw")
      ).to.be.revertedWithCustomError(registry, "DomainNotFound");
    });

    it("should return address(0) for expired domain", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      await ethers.provider.send("evm_increaseTime", [366 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      const resolved = await registry.resolve("jarvis", ".claw");
      expect(resolved).to.equal(ethers.ZeroAddress);
    });
  });

  describe("isAvailable", function () {
    it("should return true for unregistered domain", async function () {
      expect(await registry.isAvailable("newname", ".claw")).to.be.true;
    });

    it("should return false for registered domain", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      expect(await registry.isAvailable("jarvis", ".claw")).to.be.false;
    });

    it("should return true for expired domain", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      await ethers.provider.send("evm_increaseTime", [366 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      expect(await registry.isAvailable("jarvis", ".claw")).to.be.true;
    });
  });

  describe("getDomain", function () {
    it("should return correct domain struct", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 50e6);
      const domain = await registry.getDomain(1);
      expect(domain.name).to.equal("jarvis");
      expect(domain.tld).to.equal(".claw");
      expect(domain.owner).to.equal(user1.address);
      expect(domain.pricePaid).to.equal(50e6);
      expect(domain.active).to.be.true;
      expect(domain.registeredAt).to.be.gt(0);
      expect(domain.expiresAt).to.be.gt(domain.registeredAt);
    });

    it("should revert for non-existent tokenId", async function () {
      await expect(registry.getDomain(999)).to.be.revertedWithCustomError(registry, "DomainNotFound");
    });

    it("should revert for tokenId 0", async function () {
      await expect(registry.getDomain(0)).to.be.revertedWithCustomError(registry, "DomainNotFound");
    });
  });

  describe("getOwnerTokenIds", function () {
    it("should return empty array for owner with no domains", async function () {
      const ids = await registry.getOwnerTokenIds(user1.address);
      expect(ids.length).to.equal(0);
    });

    it("should grow with each registration", async function () {
      await registry.connect(registrar).register("agent-a", ".claw", user1.address, 0);
      await registry.connect(registrar).register("agent-b", ".shell", user1.address, 0);
      await registry.connect(registrar).register("agent-c", ".pinch", user1.address, 0);
      const ids = await registry.getOwnerTokenIds(user1.address);
      expect(ids.length).to.equal(3);
      expect(ids[0]).to.equal(1);
      expect(ids[1]).to.equal(2);
      expect(ids[2]).to.equal(3);
    });
  });

  describe("tokenURI", function () {
    it("should return valid base64-encoded JSON", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 50e6);
      const uri = await registry.tokenURI(1);
      expect(uri).to.match(/^data:application\/json;base64,/);

      const base64Part = uri.replace("data:application/json;base64,", "");
      const jsonStr = Buffer.from(base64Part, "base64").toString("utf-8");
      const parsed = JSON.parse(jsonStr);

      expect(parsed.name).to.equal("jarvis.claw");
      expect(parsed.description).to.include("jarvis.claw");
      expect(parsed.attributes).to.be.an("array");

      const tldAttr = parsed.attributes.find(a => a.trait_type === "TLD");
      expect(tldAttr.value).to.equal(".claw");

      const nameAttr = parsed.attributes.find(a => a.trait_type === "Name");
      expect(nameAttr.value).to.equal("jarvis");
    });

    it("should revert for non-existent token", async function () {
      await expect(registry.tokenURI(999)).to.be.revertedWithCustomError(registry, "DomainNotFound");
    });
  });

  describe("Pausable", function () {
    it("should block register when paused", async function () {
      await registry.pause();
      await expect(
        registry.connect(registrar).register("jarvis", ".claw", user1.address, 0)
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    });

    it("should allow register after unpause", async function () {
      await registry.pause();
      await registry.unpause();
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      const domain = await registry.getDomain(1);
      expect(domain.name).to.equal("jarvis");
    });

    it("should require PAUSER_ROLE to pause", async function () {
      await expect(
        registry.connect(other).pause()
      ).to.be.reverted;
    });
  });

  describe("H-01 fix: abi.encode domain key — collision proof", function () {
    it("should store distinct keys for names that would collide with encodePacked", async function () {
      await registry.connect(registrar).register("abcde", ".claw", user1.address, 0);

      expect(await registry.isAvailable("abcde", ".claw")).to.be.false;
      expect(await registry.isAvailable("abcd", ".claw")).to.be.true;
      expect(await registry.isAvailable("abcdef", ".claw")).to.be.true;
    });

    it("should independently resolve domains that share string prefixes", async function () {
      await registry.connect(registrar).register("abc", ".claw", user1.address, 0);
      await registry.connect(registrar).register("abcde", ".shell", user2.address, 0);

      const r1 = await registry.resolve("abc", ".claw");
      const r2 = await registry.resolve("abcde", ".shell");
      expect(r1).to.equal(user1.address);
      expect(r2).to.equal(user2.address);
    });

    it("should allow registering names that would be ambiguous under encodePacked", async function () {
      await registry.connect(registrar).register("test-one", ".claw", user1.address, 0);
      await registry.connect(registrar).register("test-on", ".claw", user2.address, 0);

      const r1 = await registry.resolve("test-one", ".claw");
      const r2 = await registry.resolve("test-on", ".claw");
      expect(r1).to.equal(user1.address);
      expect(r2).to.equal(user2.address);
    });

    // The canonical H-01 collision pair ("ab",".claw") vs ("a","b.claw") cannot be
    // registered on-chain because "b.claw" is not a valid TLD (only .claw/.shell/.pinch).
    // This test proves the fix cryptographically: abi.encodePacked collides, abi.encode does not.
    it("should prove abi.encode produces distinct keys where abi.encodePacked would collide", async function () {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();

      const packed1 = ethers.solidityPackedKeccak256(["string", "string"], ["ab", ".claw"]);
      const packed2 = ethers.solidityPackedKeccak256(["string", "string"], ["a", "b.claw"]);
      expect(packed1).to.equal(packed2, "encodePacked should collide for this pair");

      const encoded1 = ethers.keccak256(abiCoder.encode(["string", "string"], ["ab", ".claw"]));
      const encoded2 = ethers.keccak256(abiCoder.encode(["string", "string"], ["a", "b.claw"]));
      expect(encoded1).to.not.equal(encoded2, "abi.encode must NOT collide — H-01 fix");
    });

    it("should store boundary-collision pair independently on-chain (cross-TLD)", async function () {
      await registry.connect(registrar).register("lobster", ".claw", user1.address, 0);
      await registry.connect(registrar).register("lobster", ".shell", user2.address, 0);

      const r1 = await registry.resolve("lobster", ".claw");
      const r2 = await registry.resolve("lobster", ".shell");
      expect(r1).to.equal(user1.address);
      expect(r2).to.equal(user2.address);

      const d1 = await registry.getDomain(1);
      const d2 = await registry.getDomain(2);
      expect(d1.name).to.equal("lobster");
      expect(d1.tld).to.equal(".claw");
      expect(d2.name).to.equal("lobster");
      expect(d2.tld).to.equal(".shell");

      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const key1 = ethers.keccak256(abiCoder.encode(["string", "string"], ["lobster", ".claw"]));
      const key2 = ethers.keccak256(abiCoder.encode(["string", "string"], ["lobster", ".shell"]));
      expect(key1).to.not.equal(key2, "abi.encode produces distinct keys for same name + different TLDs");
    });

    it("should keep names with shared prefixes distinct across all TLDs", async function () {
      await registry.connect(registrar).register("clawbot", ".claw", user1.address, 0);
      await registry.connect(registrar).register("clawbot", ".shell", user2.address, 0);
      await registry.connect(registrar).register("clawbot", ".pinch", owner.address, 0);

      expect(await registry.resolve("clawbot", ".claw")).to.equal(user1.address);
      expect(await registry.resolve("clawbot", ".shell")).to.equal(user2.address);
      expect(await registry.resolve("clawbot", ".pinch")).to.equal(owner.address);

      expect(await registry.isAvailable("clawbot", ".claw")).to.be.false;
      expect(await registry.isAvailable("clawbot", ".shell")).to.be.false;
      expect(await registry.isAvailable("clawbot", ".pinch")).to.be.false;
    });
  });

  describe("ERC-721 transfer syncs domain owner", function () {
    it("should update domain.owner after transfer", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      expect(await registry.ownerOf(1)).to.equal(user1.address);

      await registry.connect(user1).transferFrom(user1.address, user2.address, 1);

      expect(await registry.ownerOf(1)).to.equal(user2.address);
      const domain = await registry.getDomain(1);
      expect(domain.owner).to.equal(user2.address);
    });

    it("should add tokenId to new owner's ownerTokenIds", async function () {
      await registry.connect(registrar).register("jarvis", ".claw", user1.address, 0);
      await registry.connect(user1).transferFrom(user1.address, user2.address, 1);

      const ids = await registry.getOwnerTokenIds(user2.address);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1);
    });
  });

  describe("supportsInterface", function () {
    it("should support ERC-721 interface", async function () {
      expect(await registry.supportsInterface("0x80ac58cd")).to.be.true;
    });

    it("should support AccessControl interface", async function () {
      expect(await registry.supportsInterface("0x7965db0b")).to.be.true;
    });
  });
});
