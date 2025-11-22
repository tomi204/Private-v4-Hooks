// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CounterHook} from "../BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/**
 * @title TestableCounterHook
 * @notice Testable version of CounterHook that skips address validation
 * @dev This contract is for testing purposes only. It overrides validateHookAddress
 *      to skip the address validation that requires specific hook addresses in production.
 *      Also exposes public test functions to directly test counter increments.
 */
contract TestableCounterHook is CounterHook {
    using PoolIdLibrary for PoolKey;

    constructor(IPoolManager _poolManager) CounterHook(_poolManager) {}

    /**
     * @notice Override to skip validation in test environment
     * @dev In production, BaseHook validates that the hook address matches
     *      the required permissions. For testing, we skip this validation.
     */
    function validateHookAddress(BaseHook) internal pure override {
        // Skip validation in test environment
    }

    // ========== TEST HELPER FUNCTIONS ==========
    // These functions expose internal hook functions for direct testing
    // DO NOT use in production contracts

    function testBeforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return _beforeSwap(sender, key, params, hookData);
    }

    function testAfterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, int128) {
        return _afterSwap(sender, key, params, delta, hookData);
    }

    function testBeforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4) {
        return _beforeAddLiquidity(sender, key, params, hookData);
    }

    function testBeforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4) {
        return _beforeRemoveLiquidity(sender, key, params, hookData);
    }
}
