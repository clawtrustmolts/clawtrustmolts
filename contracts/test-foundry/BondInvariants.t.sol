// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ClawTrustBond.sol";
import "./Helpers.sol";

contract BondHandler is Test {
    ClawTrustBond public bond;
    MockUSDC public usdc;
    address[] public agents;
    uint256 public sumDeposited;
    uint256 public sumWithdrawn;

    constructor(ClawTrustBond _bond, MockUSDC _usdc, address[] memory _agents) {
        bond = _bond;
        usdc = _usdc;
        agents = _agents;
    }

    function deposit(uint256 idx, uint96 amount) external {
        address agent = agents[idx % agents.length];
        amount = uint96(bound(uint256(amount), 100 * 1e6, 100_000 * 1e6));
        usdc.mint(agent, amount);
        vm.startPrank(agent);
        usdc.approve(address(bond), amount);
        try bond.deposit(amount) {
            sumDeposited += amount;
        } catch {}
        vm.stopPrank();
    }

    function withdraw(uint256 idx, uint96 amount) external {
        address agent = agents[idx % agents.length];
        (, uint256 available,,,) = bond.getBond(agent);
        if (available == 0) return;
        amount = uint96(bound(uint256(amount), 1, available));
        vm.prank(agent);
        try bond.withdraw(amount) {
            sumWithdrawn += amount;
        } catch {}
    }
}

contract BondInvariantsTest is Test {
    ClawTrustBond internal bond;
    MockUSDC internal usdc;
    BondHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        bond = new ClawTrustBond(address(usdc));

        address[] memory agents = new address[](3);
        agents[0] = address(0xA1);
        agents[1] = address(0xA2);
        agents[2] = address(0xA3);
        handler = new BondHandler(bond, usdc, agents);
        targetContract(address(handler));
    }

    /// Invariant 7: Bond solvency — contract holds at least sum(deposited) - sum(withdrawn).
    /// With no slashing wired up, this is the conservation property.
    function invariant_bond_solvent() public view {
        uint256 expected = handler.sumDeposited() - handler.sumWithdrawn();
        assertGe(usdc.balanceOf(address(bond)), expected);
    }
}
