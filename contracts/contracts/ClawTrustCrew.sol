// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ClawTrustCrew is Ownable, ReentrancyGuard {
    enum Role { LEAD, RESEARCHER, CODER, DESIGNER, VALIDATOR }

    struct CrewMember {
        address addr;
        Role role;
        uint256 joinedAt;
    }

    struct Crew {
        bytes32 crewId;
        string name;
        address lead;
        address[] memberAddresses;
        mapping(address => Role) memberRoles;
        mapping(address => bool) isMember;
        uint256 gigsCompleted;
        bool active;
        uint256 formedAt;
    }

    struct CrewInfo {
        bytes32 crewId;
        string name;
        address lead;
        uint256 memberCount;
        uint256 gigsCompleted;
        bool active;
        uint256 formedAt;
    }

    mapping(bytes32 => Crew) internal crews;
    mapping(bytes32 => bool) public crewExists;
    mapping(address => bytes32) public agentCrew;
    uint256 public crewCount;

    uint256 public constant MIN_MEMBERS = 2;
    uint256 public constant MAX_MEMBERS = 10;

    event CrewFormed(bytes32 indexed crewId, address indexed lead, string name, uint256 memberCount);
    event MemberAdded(bytes32 indexed crewId, address indexed member, Role role);
    event MemberRemoved(bytes32 indexed crewId, address indexed member);
    event CrewDissolved(bytes32 indexed crewId, address indexed lead);
    event GigCompleted(bytes32 indexed crewId, uint256 totalGigs);

    error CrewAlreadyExists();
    error CrewNotFound();
    error CrewNotActive();
    error NotCrewLead();
    error AlreadyInCrew();
    error NotInCrew();
    error TooFewMembers();
    error TooManyMembers();
    error InvalidAddress();
    error LeadCannotLeave();
    error InvalidRole();
    error DuplicateMember();
    error ArrayLengthMismatch();

    modifier onlyCrewLead(bytes32 crewId) {
        if(!crewExists[crewId]) revert CrewNotFound();
        if(crews[crewId].lead != msg.sender) revert NotCrewLead();
        if(!crews[crewId].active) revert CrewNotActive();
        _;
    }

    constructor() Ownable(msg.sender) {}

    function formCrew(
        string calldata name,
        address[] calldata members,
        uint8[] calldata roles
    ) external returns (bytes32) {
        if(members.length < MIN_MEMBERS) revert TooFewMembers();
        if(members.length > MAX_MEMBERS) revert TooManyMembers();
        if(members.length != roles.length) revert ArrayLengthMismatch();
        if(agentCrew[msg.sender] != bytes32(0)) revert AlreadyInCrew();

        bytes32 crewId = keccak256(abi.encodePacked(msg.sender, block.timestamp, crewCount));
        if(crewExists[crewId]) revert CrewAlreadyExists();

        Crew storage crew = crews[crewId];
        crew.crewId = crewId;
        crew.name = name;
        crew.lead = msg.sender;
        crew.active = true;
        crew.formedAt = block.timestamp;

        bool leadIncluded = false;

        for(uint256 i = 0; i < members.length; i++) {
            address member = members[i];
            if(member == address(0)) revert InvalidAddress();
            if(crew.isMember[member]) revert DuplicateMember();
            if(agentCrew[member] != bytes32(0)) revert AlreadyInCrew();
            if(roles[i] > uint8(Role.VALIDATOR)) revert InvalidRole();

            crew.memberAddresses.push(member);
            crew.memberRoles[member] = Role(roles[i]);
            crew.isMember[member] = true;
            agentCrew[member] = crewId;

            if(member == msg.sender) leadIncluded = true;
        }

        if(!leadIncluded) {
            if(members.length >= MAX_MEMBERS) revert TooManyMembers();
            crew.memberAddresses.push(msg.sender);
            crew.memberRoles[msg.sender] = Role.LEAD;
            crew.isMember[msg.sender] = true;
            agentCrew[msg.sender] = crewId;
        }

        crewExists[crewId] = true;
        crewCount++;

        emit CrewFormed(crewId, msg.sender, name, crew.memberAddresses.length);
        return crewId;
    }

    function addMember(bytes32 crewId, address member, uint8 role) external onlyCrewLead(crewId) {
        Crew storage crew = crews[crewId];
        if(member == address(0)) revert InvalidAddress();
        if(crew.isMember[member]) revert AlreadyInCrew();
        if(agentCrew[member] != bytes32(0)) revert AlreadyInCrew();
        if(crew.memberAddresses.length >= MAX_MEMBERS) revert TooManyMembers();
        if(role > uint8(Role.VALIDATOR)) revert InvalidRole();

        crew.memberAddresses.push(member);
        crew.memberRoles[member] = Role(role);
        crew.isMember[member] = true;
        agentCrew[member] = crewId;

        emit MemberAdded(crewId, member, Role(role));
    }

    function removeMember(bytes32 crewId, address member) external onlyCrewLead(crewId) {
        Crew storage crew = crews[crewId];
        if(!crew.isMember[member]) revert NotInCrew();
        if(member == crew.lead) revert LeadCannotLeave();
        if(crew.memberAddresses.length <= MIN_MEMBERS) revert TooFewMembers();

        crew.isMember[member] = false;
        delete crew.memberRoles[member];
        delete agentCrew[member];

        uint256 len = crew.memberAddresses.length;
        for(uint256 i = 0; i < len; i++) {
            if(crew.memberAddresses[i] == member) {
                crew.memberAddresses[i] = crew.memberAddresses[len - 1];
                crew.memberAddresses.pop();
                break;
            }
        }

        emit MemberRemoved(crewId, member);
    }

    function dissolveCrew(bytes32 crewId) external onlyCrewLead(crewId) {
        Crew storage crew = crews[crewId];

        for(uint256 i = 0; i < crew.memberAddresses.length; i++) {
            delete agentCrew[crew.memberAddresses[i]];
        }

        crew.active = false;

        emit CrewDissolved(crewId, msg.sender);
    }

    function recordGigCompletion(bytes32 crewId) external onlyOwner {
        if(!crewExists[crewId]) revert CrewNotFound();
        if(!crews[crewId].active) revert CrewNotActive();

        crews[crewId].gigsCompleted++;
        emit GigCompleted(crewId, crews[crewId].gigsCompleted);
    }

    function getCrewInfo(bytes32 crewId) external view returns (CrewInfo memory) {
        if(!crewExists[crewId]) revert CrewNotFound();
        Crew storage crew = crews[crewId];
        return CrewInfo({
            crewId: crew.crewId,
            name: crew.name,
            lead: crew.lead,
            memberCount: crew.memberAddresses.length,
            gigsCompleted: crew.gigsCompleted,
            active: crew.active,
            formedAt: crew.formedAt
        });
    }

    function getCrewMembers(bytes32 crewId) external view returns (CrewMember[] memory) {
        if(!crewExists[crewId]) revert CrewNotFound();
        Crew storage crew = crews[crewId];

        CrewMember[] memory members = new CrewMember[](crew.memberAddresses.length);
        for(uint256 i = 0; i < crew.memberAddresses.length; i++) {
            address addr = crew.memberAddresses[i];
            members[i] = CrewMember({
                addr: addr,
                role: crew.memberRoles[addr],
                joinedAt: crew.formedAt
            });
        }
        return members;
    }

    function verifyMembership(bytes32 crewId, address member) external view returns (bool) {
        if(!crewExists[crewId]) return false;
        return crews[crewId].isMember[member] && crews[crewId].active;
    }

    function getMemberRole(bytes32 crewId, address member) external view returns (Role) {
        if(!crewExists[crewId]) revert CrewNotFound();
        if(!crews[crewId].isMember[member]) revert NotInCrew();
        return crews[crewId].memberRoles[member];
    }

    function getAgentCrew(address agent) external view returns (bytes32) {
        return agentCrew[agent];
    }
}
