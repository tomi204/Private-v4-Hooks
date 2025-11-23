// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/**
 * @title PoolManager
 * @dev Minimal mock of IPoolManager for testing hook logic
 * Only implements the functions we actually use in tests
 * DOES NOT VALIDATE HOOK ADDRESSES - perfect for testing
 */
contract PoolManager {
    address private unlocker;
    address public immutable controller;

    constructor(address _controller) {
        controller = _controller;
    }

    // Simplified mock - just implements what we need for testing
    function unlock(bytes calldata data) external returns (bytes memory) {
        unlocker = msg.sender;
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey memory, SwapParams memory params, bytes calldata) external returns (BalanceDelta) {
        // Mock swap - returns a delta based on swap direction
        // amountSpecified is negative for exact input swaps
        int256 amountSpecified = params.amountSpecified;

        if (params.zeroForOne) {
            // Swapping token0 for token1
            // amount0 is negative (input), amount1 is positive (output)
            int128 amount0 = int128(amountSpecified); // Already negative
            int128 amount1 = -int128(amountSpecified); // Positive output (1:1 for simplicity)
            return toBalanceDelta(amount0, amount1);
        } else {
            // Swapping token1 for token0
            // amount1 is negative (input), amount0 is positive (output)
            int128 amount1 = int128(amountSpecified); // Already negative
            int128 amount0 = -int128(amountSpecified); // Positive output (1:1 for simplicity)
            return toBalanceDelta(amount0, amount1);
        }
    }

    // Helper to create BalanceDelta
    function toBalanceDelta(int128 amount0, int128 amount1) internal pure returns (BalanceDelta) {
        // Pack the two int128 values into a single int256
        int256 packed = (int256(amount0) << 128) | (int256(amount1) & type(int128).max);
        return BalanceDelta.wrap(packed);
    }

    // Minimal implementations of required functions
    function initialize(PoolKey memory, uint160) external returns (int24) {
        return 0;
    }

    function modifyLiquidity(
        PoolKey memory,
        ModifyLiquidityParams memory,
        bytes calldata
    ) external returns (BalanceDelta, BalanceDelta) {
        return (toBalanceDelta(0, 0), toBalanceDelta(0, 0));
    }

    function donate(PoolKey memory, uint256, uint256, bytes calldata) external returns (BalanceDelta) {
        return toBalanceDelta(0, 0);
    }

    function settle() external payable returns (uint256) {
        return 0;
    }

    function settleFor(address) external payable returns (uint256) {
        return 0;
    }

    function take(Currency, address, uint256) external {
        // Mock implementation
    }

    function mint(address, uint256, uint256) external {
        // Mock implementation
    }

    function burn(address, uint256, uint256) external {
        // Mock implementation
    }

    function updateDynamicLPFee(PoolKey memory, uint24) external {
        // Mock implementation
    }

    // View functions
    function protocolFeeController() external view returns (address) {
        return address(0);
    }

    function extsload(bytes32) external view returns (bytes32) {
        return bytes32(0);
    }

    function extsload(bytes32[] calldata) external view returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function exttload(bytes32[] calldata) external view returns (bytes32[] memory) {
        return new bytes32[](0);
    }
}
