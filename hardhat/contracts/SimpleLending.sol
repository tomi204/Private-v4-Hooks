// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SimpleLending is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateralToken;

    uint256 public constant ANNUAL_RATE_BPS = 600;
    uint256 public constant BPS_DENOM = 10000;
    uint256 public constant YEAR_SECONDS = 365 days;
    uint256 public constant COLLATERAL_FACTOR = 9000;

    struct BorrowPosition {
        uint256 borrowedEth;
        uint256 borrowedUsd;
        uint256 borrowTimestamp;
        bool active;
    }

    mapping(address => BorrowPosition) public borrows;

    error ZeroAmount();
    error ZeroAddress();
    error NoCollateral();
    error ExistingBorrow();
    error NoBorrow();
    error InsufficientLiquidity();
    error TransferFailed();
    error ActiveBorrow();

    event Borrow(address indexed user, uint256 ethAmount, uint256 usdValue);
    event Repay(address indexed user, uint256 principal, uint256 interest);
    event ETHDeposited(address indexed from, uint256 amount);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event CollateralWithdrawn(address indexed to, uint256 amount);
    event TokenSupplied(address indexed from, address indexed token, uint256 amount);

    constructor(IERC20 _collateralToken) Ownable(msg.sender) {
        if (address(_collateralToken) == address(0)) revert ZeroAddress();
        collateralToken = _collateralToken;
    }

    receive() external payable {
        emit ETHDeposited(msg.sender, msg.value);
    }

    function borrow(uint256 collateralAssetPrice, uint256 borrowAssetPrice) external nonReentrant {
        if (borrows[msg.sender].active) revert ExistingBorrow();

        uint256 collateralAmount = collateralToken.balanceOf(address(this));
        if (collateralAmount == 0) revert NoCollateral();

        collateralAmount = collateralAmount / 10 ** 6;

        uint256 collateralUsd = collateralAmount * collateralAssetPrice;
        uint256 usableUsd = (collateralUsd * COLLATERAL_FACTOR) / BPS_DENOM;

        if (usableUsd == 0) revert NoCollateral();

        uint256 ethToSend = (usableUsd * 1 ether) / borrowAssetPrice;
        if (ethToSend == 0) revert ZeroAmount();
        if (address(this).balance < ethToSend) revert InsufficientLiquidity();

        borrows[msg.sender] = BorrowPosition({
            borrowedEth: ethToSend,
            borrowedUsd: usableUsd,
            borrowTimestamp: block.timestamp,
            active: true
        });

        (bool sent, ) = payable(msg.sender).call{value: ethToSend}("");
        if (!sent) revert TransferFailed();

        emit Borrow(msg.sender, ethToSend, usableUsd);
    }

    function repay(uint256 amount) external payable nonReentrant {
        BorrowPosition storage pos = borrows[msg.sender];
        if (!pos.active) revert NoBorrow();

        uint256 elapsed = block.timestamp - pos.borrowTimestamp;
        uint256 interestUsd = (pos.borrowedUsd * ANNUAL_RATE_BPS * elapsed) / (BPS_DENOM * YEAR_SECONDS);
        uint256 totalOwedUsd = pos.borrowedUsd + interestUsd;

        if (amount < totalOwedUsd) revert ZeroAmount();

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Repay(msg.sender, pos.borrowedUsd, interestUsd);
        delete borrows[msg.sender];
    }

    function getOutstandingDebt(address user) external view returns (uint256 principal, uint256 interest, uint256 total) {
        BorrowPosition memory pos = borrows[user];
        if (!pos.active) return (0, 0, 0);

        principal = pos.borrowedUsd;
        uint256 elapsed = block.timestamp - pos.borrowTimestamp;
        interest = (pos.borrowedUsd * ANNUAL_RATE_BPS * elapsed) / (BPS_DENOM * YEAR_SECONDS);
        total = principal + interest;
    }

    function withdrawETH(uint256 amount, address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (address(this).balance < amount) revert InsufficientLiquidity();

        (bool sent, ) = to.call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit ETHWithdrawn(to, amount);
    }

    function withdrawCollateral(uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        collateralToken.safeTransfer(to, amount);
        emit CollateralWithdrawn(to, amount);
    }

    /**
     * @notice Supply tokens to the lending protocol
     * @dev Allows anyone to supply tokens for liquidity
     * @param token Token to supply
     * @param amount Amount to supply
     */
    function supply(IERC20 token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (address(token) == address(0)) revert ZeroAddress();

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit TokenSupplied(msg.sender, address(token), amount);
    }

    /**
     * @notice Withdraw tokens from lending protocol
     * @dev Allows authorized addresses to withdraw for liquidity shuttle
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     * @param to Address to send tokens to
     */
    function withdraw(IERC20 token, uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        uint256 available = token.balanceOf(address(this));
        if (available < amount) revert InsufficientLiquidity();

        token.safeTransfer(to, amount);
    }

    /**
     * @notice Get available balance of a token
     * @param token Token to check
     * @return Available balance
     */
    function getAvailableBalance(IERC20 token) external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
