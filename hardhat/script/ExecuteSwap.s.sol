// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

contract ExecuteSwap is Script {
    using CurrencyLibrary for Currency;

    IPoolManager constant poolManager = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address constant HOOK = 0x80B884a77Cb6167B884d3419019Df790E65440C0;
    address constant WETH = 0x0003897f666B36bf31Aa48BEEA2A57B16e60448b;
    address constant USDC = 0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0;

    function run() external {
        address deployer = 0x026ba0AA63686278C3b3b3b9C43bEdD8421E36Cd;

        console.log("Executing swap from:", deployer);

        vm.startBroadcast(deployer);

        // Deploy PoolSwapTest router
        PoolSwapTest swapRouter = new PoolSwapTest(poolManager);
        console.log("Deployed swapRouter:", address(swapRouter));

        // Sort currencies
        (address currency0, address currency1) = USDC < WETH ? (USDC, WETH) : (WETH, USDC);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });

        // Swap 0.1 WETH for USDC
        bool zeroForOne = currency0 == WETH; // WETH -> USDC if WETH is currency0
        uint256 swapAmount = 0.1 ether;
        address inputToken = zeroForOne ? currency0 : currency1;

        console.log("Minting input token...");
        bytes memory mintData = abi.encodeWithSignature("mint(address,uint256)", deployer, swapAmount);
        (bool success, ) = inputToken.call(mintData);
        require(success, "Mint failed");

        console.log("Approving router...");
        IERC20(inputToken).approve(address(swapRouter), type(uint256).max);

        console.log("Executing swap...");
        console.log("Direction:", zeroForOne ? "Token0 -> Token1" : "Token1 -> Token0");
        console.log("Amount:", swapAmount);

        // Swap params
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(swapAmount), // Negative for exact input
            sqrtPriceLimitX96: zeroForOne
                ? 4295128740 // TickMath.MIN_SQRT_PRICE + 1
                : 1461446703485210103287273052203988822378723970341 // TickMath.MAX_SQRT_PRICE - 1
        });

        // Test settings
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });

        swapRouter.swap(key, params, testSettings, "");

        console.log("Swap executed successfully!");
        console.log("beforeSwap hook was triggered!");
        console.log("afterSwap hook was triggered!");

        vm.stopBroadcast();
    }
}
