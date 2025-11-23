// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

interface IPrivacyPoolHook {
    function setSimpleLending(address lending) external;
    function simpleLending() external view returns (address);
}

contract SetSimpleLending is Script {
    address constant HOOK = 0x80B884a77Cb6167B884d3419019Df790E65440C0;
    address constant SIMPLE_LENDING = 0x3b64D86362ec9a8Cae77C661ffc95F0bbd440aa2;

    function run() external {
        address deployer = 0x026ba0AA63686278C3b3b3b9C43bEdD8421E36Cd;

        console.log("=== Configuring SimpleLending ===");
        console.log("Hook Address:", HOOK);
        console.log("SimpleLending Address:", SIMPLE_LENDING);
        console.log("Caller:", deployer);

        IPrivacyPoolHook hook = IPrivacyPoolHook(HOOK);

        // Check current state
        address currentLending = hook.simpleLending();
        console.log("\nCurrent SimpleLending:", currentLending);

        vm.startBroadcast(deployer);

        // Set SimpleLending
        console.log("\nSetting SimpleLending...");
        hook.setSimpleLending(SIMPLE_LENDING);

        vm.stopBroadcast();

        // Verify it was set
        address newLending = hook.simpleLending();
        console.log("\nNew SimpleLending:", newLending);
        console.log("Match:", newLending == SIMPLE_LENDING ? "YES" : "NO");

        require(newLending == SIMPLE_LENDING, "SimpleLending not set correctly");

        console.log("\n=== SimpleLending Configured Successfully! ===");
    }
}
