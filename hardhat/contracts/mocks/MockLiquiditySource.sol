// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ILiquiditySource} from "../interfaces/ILiquiditySource.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockLiquiditySource
 * @notice Simple mock lending protocol for testing liquidity shuttle
 * @dev Just holds tokens, no interest or complex logic
 */
contract MockLiquiditySource is ILiquiditySource {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;

    error ZeroAmount();
    error InsufficientLiquidity();
    error Unauthorized();

    address public immutable hook;

    modifier onlyHook() {
        if (msg.sender != hook) revert Unauthorized();
        _;
    }

    constructor(address _hook) {
        hook = _hook;
    }

    /**
     * @notice Withdraw tokens to hook
     */
    function withdrawLiquidity(Currency token, uint256 amount) external onlyHook returns (uint256 actualAmount) {
        if (amount == 0) revert ZeroAmount();

        address tokenAddress = Currency.unwrap(token);
        uint256 available = IERC20(tokenAddress).balanceOf(address(this));

        if (available < amount) revert InsufficientLiquidity();

        IERC20(tokenAddress).safeTransfer(hook, amount);

        return amount;
    }

    /**
     * @notice Receive tokens from hook
     */
    function depositLiquidity(Currency token, uint256 amount) external onlyHook returns (uint256 actualAmount) {
        if (amount == 0) revert ZeroAmount();

        address tokenAddress = Currency.unwrap(token);

        // Transfer from hook to this contract
        IERC20(tokenAddress).safeTransferFrom(hook, address(this), amount);

        return amount;
    }

    /**
     * @notice Check available liquidity
     */
    function availableLiquidity(Currency token) external view returns (uint256 available) {
        address tokenAddress = Currency.unwrap(token);
        return IERC20(tokenAddress).balanceOf(address(this));
    }

    /**
     * @notice Owner can fund the protocol with tokens
     */
    function fund(Currency token, uint256 amount) external {
        address tokenAddress = Currency.unwrap(token);
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
    }
}
