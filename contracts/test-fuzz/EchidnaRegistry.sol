// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/ClawTrustRegistry.sol";

/// @notice Property contract for Echidna/Medusa fuzzing of ClawTrustRegistry.
///         Targets Invariant 6 (domain uniqueness) from
///         CLAWTRUST_SECURITY_AUDIT_REPORT.md §6:
///         once a (name, tld) is registered the mapping is fixed and a
///         second register() with the same key MUST revert.
contract EchidnaRegistry {
    ClawTrustRegistry public reg;

    // Fixed pool of valid lowercase-ascii names so the fuzzer does not waste
    // sequences on ill-formed strings rejected by _validateName().
    string[8] internal NAMES;
    string[4] internal TLDS;
    address[3] internal OWNERS;

    // Tracked registrations the property checks for stability.
    bytes32[] public keys;
    mapping(bytes32 => bool) internal tracked;
    mapping(bytes32 => uint256) internal expectedTokenId;

    /// Set true if a duplicate-name register() call ever succeeded — a
    /// uniqueness violation. Flipping this to true breaks the property.
    bool public duplicateRegistered;

    constructor() {
        reg = new ClawTrustRegistry();

        NAMES[0] = "alpha";
        NAMES[1] = "bravo";
        NAMES[2] = "charlie";
        NAMES[3] = "delta";
        NAMES[4] = "echo";
        NAMES[5] = "foxtrot";
        NAMES[6] = "golf";
        NAMES[7] = "hotel";

        TLDS[0] = ".claw";
        TLDS[1] = ".shell";
        TLDS[2] = ".pinch";
        TLDS[3] = ".agent";

        OWNERS[0] = address(0xA1);
        OWNERS[1] = address(0xA2);
        OWNERS[2] = address(0xA3);
    }

    function _domainKey(string memory name, string memory tld) internal pure returns (bytes32) {
        return keccak256(abi.encode(name, tld));
    }

    // ─── Fuzzed entry points ───────────────────────────────────────

    function register(uint8 nameSeed, uint8 tldSeed, uint8 ownerSeed) external {
        string memory n = NAMES[nameSeed % NAMES.length];
        string memory t = TLDS[tldSeed % TLDS.length];
        address o = OWNERS[ownerSeed % OWNERS.length];
        bytes32 key = _domainKey(n, t);

        try reg.register(n, t, o, 0) returns (uint256 tokenId) {
            if (tracked[key]) {
                // Re-registration of an already-taken (name, tld) MUST revert.
                duplicateRegistered = true;
            } else {
                tracked[key] = true;
                expectedTokenId[key] = tokenId;
                keys.push(key);
            }
        } catch {}
    }

    /// Explicitly attempt to re-register every tracked key with a different
    /// owner, which MUST always revert.
    function reregister(uint256 idx, uint8 ownerSeed) external {
        if (keys.length == 0) return;
        // Use the same (name, tld) we tracked. We need to recover them by
        // brute-iterating over the small fixed pool until we find a match.
        bytes32 target = keys[idx % keys.length];
        for (uint256 i = 0; i < NAMES.length; i++) {
            for (uint256 j = 0; j < TLDS.length; j++) {
                if (_domainKey(NAMES[i], TLDS[j]) == target) {
                    try reg.register(NAMES[i], TLDS[j], OWNERS[ownerSeed % 3], 0) {
                        duplicateRegistered = true;
                    } catch {}
                    return;
                }
            }
        }
    }

    // ─── Properties ────────────────────────────────────────────────

    /// Invariant 6a: no duplicate registration ever succeeds.
    function echidna_no_duplicate_registration() public view returns (bool) {
        return !duplicateRegistered;
    }

    /// Invariant 6b: tracked keys remain marked taken and resolve to the same
    /// tokenId we observed at registration time.
    function echidna_domain_mapping_stable() public view returns (bool) {
        for (uint256 i = 0; i < keys.length; i++) {
            bytes32 k = keys[i];
            if (!reg.domainTaken(k)) return false;
            if (reg.domainToTokenId(k) != expectedTokenId[k]) return false;
        }
        return true;
    }
}
