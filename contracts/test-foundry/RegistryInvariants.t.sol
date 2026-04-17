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
    /// We TRANSFORM fuzzed inputs into valid form (rather than vm.assume-filtering them) so
    /// the fuzzer doesn't exhaust its 65536-rejection budget on the per-byte ASCII filter
    /// or the EOA-only address filter.
    function testFuzz_invariant_domain_uniqueness(
        bytes32 nameSeed,
        uint8 nameLenSeed,
        uint160 owner1Seed,
        uint160 owner2Seed
    ) public {
        // 1. Synthesize a deterministic, always-valid lowercase-ascii name in [3,32].
        uint256 nameLen = 3 + (uint256(nameLenSeed) % 30); // 3..32
        bytes memory nameBytes = new bytes(nameLen);
        for (uint256 i = 0; i < nameLen; i++) {
            // Map every byte into [a-z] — guarantees the registry name policy passes.
            uint8 raw = uint8(nameSeed[i % 32]);
            nameBytes[i] = bytes1(uint8(0x61 + (raw % 26)));
        }
        string memory name = string(nameBytes);

        // 2. Reject only the 11 reserved names — at most an O(2^-very_large) rejection rate.
        bytes32 nameHash = keccak256(nameBytes);
        if (
            nameHash == keccak256("admin")     ||
            nameHash == keccak256("api")       ||
            nameHash == keccak256("app")       ||
            nameHash == keccak256("trust")     ||
            nameHash == keccak256("claw")      ||
            nameHash == keccak256("molt")      ||
            nameHash == keccak256("shell")     ||
            nameHash == keccak256("pinch")     ||
            nameHash == keccak256("root")      ||
            nameHash == keccak256("clawtrust") ||
            nameHash == keccak256("agent")
        ) {
            return; // Reserved-name policy is enforced & tested separately.
        }

        // 3. Pick concrete EOAs from the seeds. We avoid address(0), the registry,
        //    precompiles 0x01..0x09, and forge-std cheatcode address (0x7109...4D67).
        //    Using uint160 seeds + simple normalisation guarantees zero rejections.
        address owner1 = _toEOA(owner1Seed, 1);
        address owner2 = _toEOA(owner2Seed, 2);
        // De-collide owner1/owner2 (allowed to be equal in principle, but keep them distinct).
        if (owner2 == owner1) owner2 = address(uint160(owner2) + 1);

        // 4. The actual invariant.
        string memory tld = ".claw";
        uint256 tokenId = reg.register(name, tld, owner1, 0);
        // _domainKey uses abi.encode (NOT encodePacked) for length-collision safety.
        bytes32 key = keccak256(abi.encode(name, tld));
        assertTrue(reg.domainTaken(key));
        assertEq(reg.domainToTokenId(key), tokenId);

        // Re-registering the same name MUST revert.
        vm.expectRevert();
        reg.register(name, tld, owner2, 0);

        // The mapping still points at the original tokenId.
        assertEq(reg.domainToTokenId(key), tokenId);
    }

    /// Map a uint160 seed to a known-safe EOA address (no code, not zero, not registry,
    /// not a precompile, not the cheatcode). Lifted ≥ 0x10000 to skip the precompile range.
    function _toEOA(uint160 seed, uint256 salt) internal view returns (address a) {
        uint160 v = (seed % type(uint128).max) + 0x10000 + uint160(salt);
        a = address(v);
        // Should already be code-free (random EOA-style address), but bump if not.
        while (a.code.length != 0 || a == address(reg)) {
            v = v + 1;
            a = address(v);
        }
    }
}
