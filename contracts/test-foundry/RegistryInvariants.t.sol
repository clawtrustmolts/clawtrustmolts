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
        vm.assume(bytes(name).length >= 3 && bytes(name).length <= 32);
        // Restrict to lowercase ascii to satisfy registry name policy.
        bytes memory b = bytes(name);
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            vm.assume((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39));
        }

        string memory tld = ".claw";
        uint256 tokenId = reg.register(name, tld, owner1, 0);
        bytes32 key = keccak256(abi.encodePacked(name, tld));
        assertTrue(reg.domainTaken(key));
        assertEq(reg.domainToTokenId(key), tokenId);

        // Re-registering the same name MUST revert.
        vm.expectRevert();
        reg.register(name, tld, owner2, 0);

        // The mapping still points at the original tokenId.
        assertEq(reg.domainToTokenId(key), tokenId);
    }
}
