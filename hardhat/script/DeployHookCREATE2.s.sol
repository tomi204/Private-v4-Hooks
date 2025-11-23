// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../contracts/PrivacyPoolHook.sol";
import "../contracts/libraries/SettlementLib.sol";

contract DeployHookCREATE2 is Script {
    function run() external {
        // Real Uniswap V4 PoolManager on Sepolia
        address poolManager = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
        address relayer = vm.envAddress("RELAYER");
        address pyth = 0xDd24F84d36BF92C65F92307595335bdFab5Bbd21; // Real Pyth on Sepolia
        bytes32 salt = bytes32(0); // Salt 0x0 produces valid hook address

        console.log("Deploying PrivacyPoolHook with CREATE2");
        console.log("PoolManager:", poolManager);
        console.log("Relayer:", relayer);
        console.log("Pyth:", pyth);
        console.log("Salt:", vm.toString(salt));

        vm.startBroadcast();

        // Deploy with CREATE2
        PrivacyPoolHook hook = new PrivacyPoolHook{salt: salt}(
            IPoolManager(poolManager),
            relayer,
            pyth
        );

        console.log("PrivacyPoolHook deployed at:", address(hook));

        // Verify address has correct flags
        uint256 addressNum = uint256(uint160(address(hook)));
        uint256 flags = addressNum & 0xFF;
        uint256 requiredFlags = 0xC0; // beforeSwap + afterSwap

        console.log("Address flags:", vm.toString(bytes32(flags)));
        console.log("Required flags:", vm.toString(bytes32(requiredFlags)));

        if ((flags & requiredFlags) == requiredFlags) {
            console.log("Valid hook address!");
        } else {
            console.log("WARNING: Invalid hook address");
        }

        // Fund the hook with 0.01 ETH
        (bool success,) = address(hook).call{value: 0.01 ether}("");
        require(success, "Failed to fund hook");
        console.log("Hook funded with 0.01 ETH");

        vm.stopBroadcast();
    }
}
