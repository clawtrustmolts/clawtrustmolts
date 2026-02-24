const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClawTrustCrew", function () {
  let crew, owner, lead, m1, m2, m3, m4, other;

  beforeEach(async function () {
    [owner, lead, m1, m2, m3, m4, other] = await ethers.getSigners();

    const Crew = await ethers.getContractFactory("ClawTrustCrew");
    crew = await Crew.deploy();
    await crew.waitForDeployment();
  });

  describe("formCrew", function () {
    it("should form a crew with lead included", async function () {
      const tx = await crew.connect(lead).formCrew(
        "Alpha Squad", [lead.address, m1.address, m2.address], [0, 2, 3]
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return crew.interface.parseLog(l)?.name === "CrewFormed"; } catch { return false; }
      });
      const parsed = crew.interface.parseLog(event);
      expect(parsed.args.lead).to.equal(lead.address);
      expect(parsed.args.memberCount).to.equal(3);

      const crewId = parsed.args.crewId;
      const info = await crew.getCrewInfo(crewId);
      expect(info.name).to.equal("Alpha Squad");
      expect(info.active).to.equal(true);
      expect(info.memberCount).to.equal(3);
    });

    it("should auto-add lead if not in members list", async function () {
      const tx = await crew.connect(lead).formCrew(
        "Beta Squad", [m1.address, m2.address], [1, 2]
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return crew.interface.parseLog(l)?.name === "CrewFormed"; } catch { return false; }
      });
      const parsed = crew.interface.parseLog(event);
      expect(parsed.args.memberCount).to.equal(3);
    });

    it("should revert with less than 2 members", async function () {
      await expect(
        crew.connect(lead).formCrew("Small", [lead.address], [0])
      ).to.be.revertedWithCustomError(crew, "TooFewMembers");
    });

    it("should revert with more than 10 members", async function () {
      const signers = await ethers.getSigners();
      const members = signers.slice(1, 12).map(s => s.address);
      const roles = new Array(11).fill(1);
      await expect(
        crew.connect(lead).formCrew("Huge", members, roles)
      ).to.be.revertedWithCustomError(crew, "TooManyMembers");
    });

    it("should revert on duplicate members", async function () {
      await expect(
        crew.connect(lead).formCrew("Dup", [m1.address, m1.address], [1, 2])
      ).to.be.revertedWithCustomError(crew, "DuplicateMember");
    });

    it("should revert if lead is already in a crew", async function () {
      await crew.connect(lead).formCrew("First", [lead.address, m1.address], [0, 1]);
      await expect(
        crew.connect(lead).formCrew("Second", [lead.address, m2.address], [0, 1])
      ).to.be.revertedWithCustomError(crew, "AlreadyInCrew");
    });

    it("should revert if member is already in a crew", async function () {
      await crew.connect(lead).formCrew("First", [lead.address, m1.address], [0, 1]);
      await expect(
        crew.connect(m2).formCrew("Second", [m2.address, m1.address], [0, 1])
      ).to.be.revertedWithCustomError(crew, "AlreadyInCrew");
    });

    it("should revert on invalid role", async function () {
      await expect(
        crew.connect(lead).formCrew("Bad", [lead.address, m1.address], [0, 99])
      ).to.be.revertedWithCustomError(crew, "InvalidRole");
    });

    it("should revert on array length mismatch", async function () {
      await expect(
        crew.connect(lead).formCrew("Mismatch", [lead.address, m1.address], [0])
      ).to.be.revertedWithCustomError(crew, "ArrayLengthMismatch");
    });
  });

  describe("addMember", function () {
    let crewId;

    beforeEach(async function () {
      const tx = await crew.connect(lead).formCrew(
        "Test Crew", [lead.address, m1.address], [0, 2]
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return crew.interface.parseLog(l)?.name === "CrewFormed"; } catch { return false; }
      });
      crewId = crew.interface.parseLog(event).args.crewId;
    });

    it("lead can add member", async function () {
      await crew.connect(lead).addMember(crewId, m2.address, 3);
      expect(await crew.verifyMembership(crewId, m2.address)).to.equal(true);
    });

    it("non-lead cannot add member", async function () {
      await expect(
        crew.connect(m1).addMember(crewId, m2.address, 3)
      ).to.be.revertedWithCustomError(crew, "NotCrewLead");
    });

    it("cannot add member already in a crew", async function () {
      await expect(
        crew.connect(lead).addMember(crewId, m1.address, 3)
      ).to.be.revertedWithCustomError(crew, "AlreadyInCrew");
    });
  });

  describe("removeMember", function () {
    let crewId;

    beforeEach(async function () {
      const tx = await crew.connect(lead).formCrew(
        "Test Crew", [lead.address, m1.address, m2.address], [0, 2, 3]
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return crew.interface.parseLog(l)?.name === "CrewFormed"; } catch { return false; }
      });
      crewId = crew.interface.parseLog(event).args.crewId;
    });

    it("lead can remove member", async function () {
      await crew.connect(lead).removeMember(crewId, m1.address);
      expect(await crew.verifyMembership(crewId, m1.address)).to.equal(false);
    });

    it("lead cannot remove themselves", async function () {
      await expect(
        crew.connect(lead).removeMember(crewId, lead.address)
      ).to.be.revertedWithCustomError(crew, "LeadCannotLeave");
    });

    it("cannot remove below minimum members", async function () {
      await crew.connect(lead).removeMember(crewId, m1.address);
      await expect(
        crew.connect(lead).removeMember(crewId, m2.address)
      ).to.be.revertedWithCustomError(crew, "TooFewMembers");
    });

    it("cannot remove non-member", async function () {
      await expect(
        crew.connect(lead).removeMember(crewId, other.address)
      ).to.be.revertedWithCustomError(crew, "NotInCrew");
    });
  });

  describe("dissolveCrew", function () {
    let crewId;

    beforeEach(async function () {
      const tx = await crew.connect(lead).formCrew(
        "Test Crew", [lead.address, m1.address], [0, 2]
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return crew.interface.parseLog(l)?.name === "CrewFormed"; } catch { return false; }
      });
      crewId = crew.interface.parseLog(event).args.crewId;
    });

    it("lead can dissolve", async function () {
      await crew.connect(lead).dissolveCrew(crewId);
      const info = await crew.getCrewInfo(crewId);
      expect(info.active).to.equal(false);
      expect(await crew.getAgentCrew(lead.address)).to.equal(ethers.ZeroHash);
      expect(await crew.getAgentCrew(m1.address)).to.equal(ethers.ZeroHash);
    });

    it("non-lead cannot dissolve", async function () {
      await expect(
        crew.connect(m1).dissolveCrew(crewId)
      ).to.be.revertedWithCustomError(crew, "NotCrewLead");
    });

    it("members can join new crew after dissolve", async function () {
      await crew.connect(lead).dissolveCrew(crewId);
      await crew.connect(lead).formCrew("New Crew", [lead.address, m1.address], [0, 1]);
    });
  });

  describe("verifyMembership", function () {
    it("returns false for non-existent crew", async function () {
      expect(await crew.verifyMembership(ethers.id("fake"), other.address)).to.equal(false);
    });
  });

  describe("recordGigCompletion", function () {
    let crewId;

    beforeEach(async function () {
      const tx = await crew.connect(lead).formCrew(
        "Test Crew", [lead.address, m1.address], [0, 2]
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return crew.interface.parseLog(l)?.name === "CrewFormed"; } catch { return false; }
      });
      crewId = crew.interface.parseLog(event).args.crewId;
    });

    it("owner can record gig completion", async function () {
      await crew.recordGigCompletion(crewId);
      const info = await crew.getCrewInfo(crewId);
      expect(info.gigsCompleted).to.equal(1);
    });

    it("non-owner cannot record", async function () {
      await expect(
        crew.connect(lead).recordGigCompletion(crewId)
      ).to.be.revertedWithCustomError(crew, "OwnableUnauthorizedAccount");
    });
  });

  describe("getCrewMembers", function () {
    it("should return all members with roles", async function () {
      const tx = await crew.connect(lead).formCrew(
        "Test", [lead.address, m1.address, m2.address], [0, 2, 4]
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return crew.interface.parseLog(l)?.name === "CrewFormed"; } catch { return false; }
      });
      const crewId = crew.interface.parseLog(event).args.crewId;

      const members = await crew.getCrewMembers(crewId);
      expect(members.length).to.equal(3);
    });
  });
});
