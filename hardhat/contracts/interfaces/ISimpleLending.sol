// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ISimpleLending
 * @notice Interface for SimpleLending protocol
 */
interface ISimpleLending {
    function supply(IERC20 token, uint256 amount) external;
    function withdraw(IERC20 token, uint256 amount, address to) external;
    function getAvailableBalance(IERC20 token) external view returns (uint256);
}
