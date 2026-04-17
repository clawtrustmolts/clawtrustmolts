// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ClawTrustRegistry.sol";

contract RegistryInvariantsTest is Test {
    ClawTrustRegistry internal reg;

    function setUp() public {
        reg = new ClawTrustRegistry();
    }

    /// Invariant 6: Domain uniqueness — domainTaken[key] => exactly one tokenId resolves to it.
    function testFuzz_invariant_domain_uniqueness(
        string memory name,
        address owner1,
        address owner2
    ) public {
        vm.assume(owner1 != address(0) && owner2 != address(0));
        // _safeMint requires receivers to be EOAs or ERC721Receiver implementers.
        // Filter to addresses with no code (EOAs + unused precompile slots),
        // and exclude the registry itself.
        vm.assume(owner1.code.length == 0 && owner2.code.length == 0);
        vm.assume(owner1 != address(reg) && owner2 != address(reg));
        vm.assume(bytes(name).length >= 3 && bytes(name).length <= 32);
        // Restrict to lowercase ascii to satisfy registry name policy.
        bytes memory b = bytes(name);
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            vm.assume((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39));
        }
        // Skip reserved names (admin, api, app, trust, claw, molt, shell,
        // pinch, root, clawtrust, agent) — they revert with ReservedName()
        // by design and are not relevant to the uniqueness invariant.
        bytes32 nameHash = keccak256(bytes(name));
        vm.assume(nameHash != keccak256("admin"));
        vm.assume(nameHash != keccak256("api"));
        vm.assume(nameHash != keccak256("app"));
        vm.assume(nameHash != keccak256("trust"));
        vm.assume(nameHash != keccak256("claw"));
        vm.assume(nameHash != keccak256("molt"));
        vm.assume(nameHash != keccak256("shell"));
        vm.assume(nameHash != keccak256("pinch"));
        vm.assume(nameHash != keccak256("root"));
        vm.assume(nameHash != keccak256("clawtrust"));
        vm.assume(nameHash != keccak256("agent"));

        string memory tld = ".claw";
        uint256 tokenId = reg.register(name, tld, owner1, 0);
        // _domainKey in the contract uses abi.encode (NOT abi.encodePacked) to
        // prevent length-collision attacks. The test must mirror that exactly.
        bytes32 key = keccak256(abi.encode(name, tld));
        assertTrue(reg.domainTaken(key));
        assertEq(reg.domainToTokenId(key), tokenId);

        // Re-registering the same name MUST revert.
        vm.expectRevert();
        reg.register(name, tld, owner2, 0);

        // The mapping still points at the original tokenId.
        assertEq(reg.domainToTokenId(key), tokenId);
    }
}
