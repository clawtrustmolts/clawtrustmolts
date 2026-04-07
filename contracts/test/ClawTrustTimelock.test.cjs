const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ClawTrustTimelock + GuardianPausable", function () {
  let timelock, escrow, mockUsdc, mockClawCard, mockSwarm;
  let owner, safe, guardian, alice, bob;

  const TWO_MINUTES = 2 * 60; // short delay for testing
  const NEW_FEE = 500;

  beforeEach(async function () {
    [owner, safe, guardian, alice, bob] = await ethers.getSigners();

    // Deploy timelock with 2-minute delay (real mainnet = 48h)
    const Timelock = await ethers.getContractFactory("ClawTrustTimelock");
    timelock = await Timelock.deploy(TWO_MINUTES, safe.address);
    await timelock.waitForDeployment();

    // Deploy supporting mocks
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUsdc = await MockERC20.deploy("USDC", "USDC", 6);

    const MockClawCard = await ethers.getContractFactory("MockClawCard");
    mockClawCard = await MockClawCard.deploy();

    const SwarmValidator = await ethers.getContractFactory("ClawTrustSwarmValidator");
    mockSwarm = await SwarmValidator.deploy(owner.address);

    const Escrow = await ethers.getContractFactory("ClawTrustEscrow");
    escrow = await Escrow.deploy(
      await mockUsdc.getAddress(),
      await mockSwarm.getAddress(),
      250,
      await mockClawCard.getAddress(),
      ethers.ZeroAddress
    );
  });

  // ─── Timelock configuration ────────────────────────────────────────

  describe("ClawTrustTimelock configuration", function () {
    it("should have the PROPOSER_ROLE for the Safe", async function () {
      const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
      expect(await timelock.hasRole(PROPOSER_ROLE, safe.address)).to.equal(true);
    });

    it("should have the CANCELLER_ROLE for the Safe", async function () {
      const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
      expect(await timelock.hasRole(CANCELLER_ROLE, safe.address)).to.equal(true);
    });

    it("should allow anyone to execute after delay (open executor)", async function () {
      const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
      // address(0) as executor means anyone can execute
      expect(await timelock.hasRole(EXECUTOR_ROLE, ethers.ZeroAddress)).to.equal(true);
    });

    it("should NOT give admin role to the Safe (self-administered only)", async function () {
      const ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();
      expect(await timelock.hasRole(ADMIN_ROLE, safe.address)).to.equal(false);
    });

    it("timelock itself has the admin role (self-administered)", async function () {
      const ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();
      expect(await timelock.hasRole(ADMIN_ROLE, await timelock.getAddress())).to.equal(true);
    });

    it("should have the correct minimum delay", async function () {
      expect(await timelock.getMinDelay()).to.equal(TWO_MINUTES);
    });

    it("MAINNET_DELAY constant should be 48 hours", async function () {
      expect(await timelock.MAINNET_DELAY()).to.equal(48 * 3600);
    });
  });

  // ─── Timelock operation flow ──────────────────────────────────────

  describe("Timelock operation flow (schedule → wait → execute)", function () {
    async function transferEscrowOwnershipToTimelock() {
      // Step 1: current owner (deployer) proposes ownership transfer to timelock
      await escrow.connect(owner).transferOwnership(await timelock.getAddress());
      // Step 2: timelock accepts (schedules acceptance call)
      const data = escrow.interface.encodeFunctionData("acceptOwnership");
      const timelockAddr = await timelock.getAddress();
      const escrowAddr = await escrow.getAddress();

      await timelock.connect(safe).schedule(
        escrowAddr, 0, data, ethers.ZeroHash, ethers.ZeroHash, TWO_MINUTES
      );
      await time.increase(TWO_MINUTES + 1);
      await timelock.execute(escrowAddr, 0, data, ethers.ZeroHash, ethers.ZeroHash);

      expect(await escrow.owner()).to.equal(timelockAddr);
    }

    it("should transfer Escrow ownership to timelock successfully", async function () {
      await transferEscrowOwnershipToTimelock();
      expect(await escrow.owner()).to.equal(await timelock.getAddress());
    });

    it("should enforce delay before execution", async function () {
      await escrow.connect(owner).transferOwnership(await timelock.getAddress());
      const data = escrow.interface.encodeFunctionData("acceptOwnership");
      const escrowAddr = await escrow.getAddress();

      await timelock.connect(safe).schedule(
        escrowAddr, 0, data, ethers.ZeroHash, ethers.ZeroHash, TWO_MINUTES
      );

      // Try to execute before delay
      await expect(
        timelock.execute(escrowAddr, 0, data, ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");
    });

    it("only Safe (proposer) can schedule operations", async function () {
      const data = escrow.interface.encodeFunctionData("acceptOwnership");
      const escrowAddr = await escrow.getAddress();

      await expect(
        timelock.connect(alice).schedule(
          escrowAddr, 0, data, ethers.ZeroHash, ethers.ZeroHash, TWO_MINUTES
        )
      ).to.be.revertedWithCustomError(timelock, "AccessControlUnauthorizedAccount");
    });

    it("Safe can cancel a pending operation", async function () {
      const data = escrow.interface.encodeFunctionData("acceptOwnership");
      const escrowAddr = await escrow.getAddress();

      await timelock.connect(safe).schedule(
        escrowAddr, 0, data, ethers.ZeroHash, ethers.ZeroHash, TWO_MINUTES
      );

      const opId = await timelock.hashOperation(
        escrowAddr, 0, data, ethers.ZeroHash, ethers.ZeroHash
      );

      await timelock.connect(safe).cancel(opId);

      // Operation should be in Unset state
      expect(await timelock.getOperationState(opId)).to.equal(0); // Unset
    });

    it("admin function on Escrow goes through timelock after ownership transfer", async function () {
      await transferEscrowOwnershipToTimelock();

      // Now setTreasury must go through timelock
      const newTreasury = alice.address;
      const data = escrow.interface.encodeFunctionData("setTreasury", [newTreasury]);
      const escrowAddr = await escrow.getAddress();

      await timelock.connect(safe).schedule(
        escrowAddr, 0, data, ethers.ZeroHash, ethers.ZeroHash, TWO_MINUTES
      );
      await time.increase(TWO_MINUTES + 1);
      await timelock.execute(escrowAddr, 0, data, ethers.ZeroHash, ethers.ZeroHash);

      expect(await escrow.treasury()).to.equal(newTreasury);
    });

    it("direct admin call on Escrow fails after timelock takes ownership", async function () {
      await transferEscrowOwnershipToTimelock();

      // Old owner (deployer) can no longer call admin functions directly
      await expect(
        escrow.connect(owner).setTreasury(alice.address)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  // ─── GuardianPausable — guardian can pause instantly ──────────────

  describe("GuardianPausable — guardian role", function () {
    beforeEach(async function () {
      // Set guardian to a hot wallet (e.g. team member or Safe)
      await escrow.connect(owner).setGuardian(guardian.address);
    });

    it("guardian can pause without timelock", async function () {
      await escrow.connect(guardian).pause();
      expect(await escrow.paused()).to.equal(true);
    });

    it("owner can still pause (no change)", async function () {
      await escrow.connect(owner).pause();
      expect(await escrow.paused()).to.equal(true);
    });

    it("random address cannot pause", async function () {
      await expect(
        escrow.connect(alice).pause()
      ).to.be.revertedWithCustomError(escrow, "NotGuardian");
    });

    it("guardian CANNOT unpause (prevents exploited key from unpausing)", async function () {
      await escrow.connect(guardian).pause();
      await expect(
        escrow.connect(guardian).unpause()
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("only owner can unpause", async function () {
      await escrow.connect(owner).pause();
      await escrow.connect(owner).unpause();
      expect(await escrow.paused()).to.equal(false);
    });

    it("owner can rotate the guardian", async function () {
      await escrow.connect(owner).setGuardian(alice.address);
      expect(await escrow.guardian()).to.equal(alice.address);
    });

    it("owner can remove guardian by setting to zero address", async function () {
      await escrow.connect(owner).setGuardian(ethers.ZeroAddress);
      expect(await escrow.guardian()).to.equal(ethers.ZeroAddress);
    });

    it("non-owner cannot set guardian", async function () {
      await expect(
        escrow.connect(alice).setGuardian(alice.address)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("setGuardian emits GuardianUpdated event", async function () {
      await expect(escrow.connect(owner).setGuardian(alice.address))
        .to.emit(escrow, "GuardianUpdated")
        .withArgs(guardian.address, alice.address);
    });
  });

  // ─── GuardianPausable — all 5 contracts have it ───────────────────

  describe("All 5 contracts inherit GuardianPausable correctly", function () {
    async function deployAll() {
      const MockRepAdapter = await ethers.deployContract("MockRepAdapter");
      const MockBond = await ethers.deployContract("MockBond");
      const MockRegistry = await ethers.deployContract("MockRepRegistry");

      const Validator = await ethers.getContractFactory("ClawTrustSwarmValidator");
      const validator = await Validator.deploy(owner.address);

      const Adapter = await ethers.getContractFactory("ClawTrustRepAdapter");
      const adapter = await Adapter.deploy(await MockRegistry.getAddress());

      const AC = await ethers.getContractFactory("ClawTrustAC");
      const ac = await AC.deploy(
        await mockClawCard.getAddress(),
        await MockRepAdapter.getAddress(),
        await MockBond.getAddress(),
        await mockUsdc.getAddress(),
        alice.address,
        bob.address
      );

      const Bond = await ethers.getContractFactory("ClawTrustBond");
      const bond = await Bond.deploy(await mockUsdc.getAddress());

      return { escrow, validator, adapter, ac, bond };
    }

    it("all contracts expose guardian() getter", async function () {
      const all = await deployAll();
      for (const [name, contract] of Object.entries(all)) {
        expect(await contract.guardian(), `${name}.guardian() failed`).to.equal(ethers.ZeroAddress);
      }
    });

    it("all contracts expose setGuardian()", async function () {
      const all = await deployAll();
      for (const [name, contract] of Object.entries(all)) {
        await expect(
          contract.connect(owner).setGuardian(guardian.address),
          `${name}.setGuardian() failed`
        ).to.emit(contract, "GuardianUpdated");
      }
    });

    it("guardian can pause all 5 contracts", async function () {
      const all = await deployAll();
      for (const [name, contract] of Object.entries(all)) {
        await contract.connect(owner).setGuardian(guardian.address);
        await contract.connect(guardian).pause();
        expect(await contract.paused(), `${name} should be paused`).to.equal(true);
      }
    });

    it("guardian cannot unpause any contract", async function () {
      const all = await deployAll();
      for (const [name, contract] of Object.entries(all)) {
        await contract.connect(owner).setGuardian(guardian.address);
        await contract.connect(guardian).pause();
        await expect(
          contract.connect(guardian).unpause(),
          `${name} guardian unpause should fail`
        ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
      }
    });
  });
});
