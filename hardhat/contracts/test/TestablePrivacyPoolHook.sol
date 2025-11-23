// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {PrivacyPoolHook} from "../PrivacyPoolHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/**
 * @title TestablePrivacyPoolHook
 * @notice Testable version of PrivacyPoolHook that skips address validation
 * @dev This contract is for testing purposes only. It overrides validateHookAddress
 *      to skip the address validation that requires specific hook addresses in production.
 */
contract TestablePrivacyPoolHook is PrivacyPoolHook {
    constructor(
        IPoolManager _poolManager,
        address _relayer,
        address _pyth
    ) PrivacyPoolHook(_poolManager, _relayer, _pyth) {}

    /**
     * @notice Override to skip validation in test environment
     * @dev In production, BaseHook validates that the hook address matches
     *      the required permissions. For testing, we skip this validation.
     */
    function validateHookAddress(BaseHook) internal pure override {
        // Skip validation in test environment
    }

    /**
     * @notice Test helper to call beforeSwap
     */
    function testBeforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4, BeforeSwapDelta, uint24) {
        return _beforeSwap(sender, key, params, hookData);
    }

    /**
     * @notice Test helper to call afterSwap
     */
    function testAfterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, int128) {
        return _afterSwap(sender, key, params, delta, hookData);
    }
}
