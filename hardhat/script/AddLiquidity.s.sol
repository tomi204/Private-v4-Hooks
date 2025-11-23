// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

contract AddLiquidity is Script {
    using CurrencyLibrary for Currency;

    IPoolManager constant poolManager = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address constant HOOK = 0x80B884a77Cb6167B884d3419019Df790E65440C0;
    address constant WETH = 0x0003897f666B36bf31Aa48BEEA2A57B16e60448b;
    address constant USDC = 0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0;

    function run() external {
        address deployer = 0x026ba0AA63686278C3b3b3b9C43bEdD8421E36Cd;

        console.log("Adding liquidity from:", deployer);

        vm.startBroadcast(deployer);

        // Deploy PoolModifyLiquidityTest router
        PoolModifyLiquidityTest modifyLiquidityRouter = new PoolModifyLiquidityTest(poolManager);
        console.log("Deployed modifyLiquidityRouter:", address(modifyLiquidityRouter));

        // Sort currencies
        (address currency0, address currency1) = USDC < WETH ? (USDC, WETH) : (WETH, USDC);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });

        // Mint tokens - need HUGE amounts for wide range liquidity
        // For 1000 ether liquidityDelta with tickRange -6000 to 6000, we need ~260 ether of each
        uint256 amount0 = 1000 ether;
        uint256 amount1 = 1000 ether; // Same amount in 18 decimals for USDC (will be converted)

        console.log("Minting tokens...");
        bytes memory mintData0 = abi.encodeWithSignature("mint(address,uint256)", deployer, amount0);
        (bool success0,) = currency0.call(mintData0);
        require(success0, "Token0 mint failed");

        bytes memory mintData1 = abi.encodeWithSignature("mint(address,uint256)", deployer, amount1);
        (bool success1,) = currency1.call(mintData1);
        require(success1, "Token1 mint failed");

        console.log("Approving router...");
        IERC20(currency0).approve(address(modifyLiquidityRouter), type(uint256).max);
        IERC20(currency1).approve(address(modifyLiquidityRouter), type(uint256).max);

        console.log("Adding liquidity...");

        // Moderate range liquidity position around current price
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: -6000,
            tickUpper: 6000,
            liquidityDelta: 1000 ether, // Good amount of liquidity
            salt: bytes32(0)
        });

        modifyLiquidityRouter.modifyLiquidity(key, params, "");

        console.log("Liquidity added successfully!");

        vm.stopBroadcast();
    }
}
