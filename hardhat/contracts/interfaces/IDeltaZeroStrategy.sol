// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

interface IDeltaZeroStrategy {
    function executeRebalance(PoolKey calldata key, PoolId poolId, uint256 swapAmount) external;
}
