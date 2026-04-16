// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/ClawCardNFT.sol";

/// @notice Property contract for Echidna/Medusa fuzzing of ClawCardNFT.
///         Targets Invariant 4 (soulbound transfers) from
///         CLAWTRUST_SECURITY_AUDIT_REPORT.md §6:
///         every transfer / approve / setApprovalForAll attempt MUST revert
///         and the original owner MUST never change.
contract EchidnaSoulbound {
    ClawCardNFT public card;

    address public constant ORIGINAL_OWNER = address(0xBEEF);
    uint256 public mintedTokenId;

    /// Set to true if any transfer-class call ever succeeds (which would be
    /// a soulbound violation). Flipping this to true breaks the property.
    bool public transferSucceeded;

    constructor() {
        card = new ClawCardNFT("ipfs://baseuri/");
        // Property contract holds MINTER_ROLE from constructor and mints the
        // single passport whose ownership we then assert is immutable.
        card.mintTo(ORIGINAL_OWNER, "agent-soulbound");
        // Token IDs in ClawCardNFT start at 1.
        mintedTokenId = 1;
    }

    // ─── Fuzzed entry points: each MUST revert ─────────────────────

    function tryTransferFrom(address from, address to, uint256 tokenId) external {
        try card.transferFrom(from, to, tokenId) {
            transferSucceeded = true;
        } catch {}
    }

    function trySafeTransferFrom(address from, address to, uint256 tokenId) external {
        try card.safeTransferFrom(from, to, tokenId, "") {
            transferSucceeded = true;
        } catch {}
    }

    function trySafeTransferFromNoData(address from, address to, uint256 tokenId) external {
        try card.safeTransferFrom(from, to, tokenId) {
            transferSucceeded = true;
        } catch {}
    }

    function tryApprove(address spender, uint256 tokenId) external {
        try card.approve(spender, tokenId) {
            transferSucceeded = true;
        } catch {}
    }

    function trySetApprovalForAll(address operator, bool approved) external {
        try card.setApprovalForAll(operator, approved) {
            transferSucceeded = true;
        } catch {}
    }

    // ─── Properties ────────────────────────────────────────────────

    /// Invariant 4a: no transfer / approve method may ever succeed.
    function echidna_no_transfer_succeeded() public view returns (bool) {
        return !transferSucceeded;
    }

    /// Invariant 4b: ownership of the minted passport is immutable.
    function echidna_owner_unchanged() public view returns (bool) {
        return card.ownerOf(mintedTokenId) == ORIGINAL_OWNER;
    }

    /// Invariant 4c: no operator approval may ever be active.
    function echidna_no_approval_for_all() public view returns (bool) {
        return !card.isApprovedForAll(ORIGINAL_OWNER, address(this));
    }
}
