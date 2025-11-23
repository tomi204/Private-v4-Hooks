// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/**
 * @title ILiquiditySource
 * @notice Interface for lending protocols that provide liquidity shuttle functionality
 * @dev Hook withdraws before swap, redeposits after swap - all in same tx
 */
interface ILiquiditySource {
    /**
     * @notice Withdraw tokens from lending protocol
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     * @return actualAmount Actual amount withdrawn
     */
    function withdrawLiquidity(Currency token, uint256 amount) external returns (uint256 actualAmount);

    /**
     * @notice Deposit tokens back to lending protocol
     * @param token Token to deposit
     * @param amount Amount to deposit
     * @return actualAmount Actual amount deposited
     */
    function depositLiquidity(Currency token, uint256 amount) external returns (uint256 actualAmount);

    /**
     * @notice Check available liquidity for a token
     * @param token Token to check
     * @return available Available amount
     */
    function availableLiquidity(Currency token) external view returns (uint256 available);
}
