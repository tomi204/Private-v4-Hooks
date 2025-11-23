// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

contract InitializePool is Script {
    // Real Uniswap V4 PoolManager on Sepolia
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;

    // Our deployed hook
    address constant HOOK = 0x80B884a77Cb6167B884d3419019Df790E65440C0;

    // Mock tokens on Sepolia
    address constant WETH = 0x0003897f666B36bf31Aa48BEEA2A57B16e60448b;
    address constant USDC = 0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0;

    function run() external {
        console.log("\n=== Initializing Uniswap V4 Pool ===\n");

        // Sort currencies (WETH < USDC)
        address currency0 = WETH < USDC ? WETH : USDC;
        address currency1 = WETH < USDC ? USDC : WETH;

        console.log("Currency0:", currency0);
        console.log("Currency1:", currency1);
        console.log("Hook:", HOOK);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: 3000, // 0.3%
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });

        // 1:1 price
        uint160 sqrtPriceX96 = 79228162514264337593543950336;

        vm.startBroadcast();

        IPoolManager poolManager = IPoolManager(POOL_MANAGER);

        console.log("\nInitializing pool at 1:1 price...");
        int24 tick = poolManager.initialize(key, sqrtPriceX96);

        console.log("Pool initialized successfully!");
        console.log("Initial tick:", vm.toString(tick));

        vm.stopBroadcast();
    }
}
