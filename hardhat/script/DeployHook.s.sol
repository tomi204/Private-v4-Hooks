// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {PrivacyPoolHook} from "../contracts/PrivacyPoolHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract DeployHook is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Real Uniswap V4 PoolManager on Sepolia
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant PYTH = 0xDd24F84d36BF92C65F92307595335bdFab5Bbd21;

    function run() external {
        address relayer = vm.envAddress("RELAYER");

        console.log("Mining hook address with correct flags...");

        // Define required flags for our hook
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        );

        // Constructor arguments
        bytes memory constructorArgs = abi.encode(
            POOL_MANAGER,
            relayer,
            PYTH
        );

        // Mine a salt that will produce a hook address with the correct flags
        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            type(PrivacyPoolHook).creationCode,
            constructorArgs
        );

        console.log("Mined hook address:", hookAddress);
        console.log("Salt:", vm.toString(salt));

        // Verify flags
        uint256 addressFlags = uint256(uint160(hookAddress)) & 0xFFFF;
        console.log("Address flags:", vm.toString(bytes32(addressFlags)));

        vm.startBroadcast();

        // Deploy the hook using CREATE2 with the mined salt
        PrivacyPoolHook deployedHook = new PrivacyPoolHook{salt: salt}(
            IPoolManager(POOL_MANAGER),
            relayer,
            PYTH
        );

        require(address(deployedHook) == hookAddress, "Hook address mismatch");

        console.log("\n=== Hook Deployed Successfully ===");
        console.log("Hook Address:", address(deployedHook));

        // Fund the hook with 0.01 ETH
        (bool success,) = address(deployedHook).call{value: 0.01 ether}("");
        require(success, "Failed to fund hook");
        console.log("Hook funded with 0.01 ETH");

        vm.stopBroadcast();
    }
}
