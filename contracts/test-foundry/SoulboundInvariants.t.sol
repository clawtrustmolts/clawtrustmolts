// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ClawCardNFT.sol";

contract SoulboundInvariantsTest is Test {
    ClawCardNFT internal card;
    address internal user = address(0xBEEF);

    function setUp() public {
        card = new ClawCardNFT("ipfs://baseuri/");
        // Mint a passport to user under MINTER_ROLE granted to deployer (this).
        card.mintTo(user, "agent-1");
    }

    /// Invariant 4: Soulbound — any transfer attempt MUST revert.
    function testFuzz_invariant_soulbound_transferFrom(address from, address to, uint256 tokenId) public {
        vm.prank(from);
        vm.expectRevert();
        card.transferFrom(from, to, tokenId);
    }

    function testFuzz_invariant_soulbound_safeTransferFrom(address from, address to, uint256 tokenId) public {
        vm.prank(from);
        vm.expectRevert();
        card.safeTransferFrom(from, to, tokenId, "");
    }

    function testFuzz_invariant_soulbound_approve(address spender, uint256 tokenId) public {
        vm.expectRevert();
        card.approve(spender, tokenId);
    }

    function testFuzz_invariant_soulbound_setApprovalForAll(address operator, bool approved) public {
        vm.expectRevert();
        card.setApprovalForAll(operator, approved);
    }
}
