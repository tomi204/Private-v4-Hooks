// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IDeltaZeroStrategy} from "./interfaces/IDeltaZeroStrategy.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface ISimpleLending {
    function collateralToken() external view returns (IERC20);

    function borrow(uint256 collateralAssetPrice, uint256 borrowAssetPrice) external;

    function repay(uint256 amount) external payable;
}

contract DeltaZeroStrategy is IDeltaZeroStrategy, Ownable2Step {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    ISimpleLending public immutable simpleLending;

    uint256 public constant TICK_LOWER_BOUND_BPS = 9500;
    uint256 public constant TICK_UPPER_BOUND_BPS = 10500;
    uint256 public constant REBALANCE_PERCENTAGE_NORMAL = 500;
    uint256 public constant REBALANCE_PERCENTAGE_HIGH = 2500;
    uint256 public constant BPS_DENOMINATOR = 10000;

    event RebalanceExecuted(PoolId indexed poolId, string action, uint256 amount);
    event PoolStateRetrieved(uint160 sqrtPriceX96, int24 tick, uint24 lpFee);

    error OnlyHook();

    address public hook;

    modifier onlyHook() {
        if (msg.sender != hook) revert OnlyHook();
        _;
    }

    constructor(IPoolManager _poolManager, address _simpleLending) Ownable(msg.sender) {
        poolManager = _poolManager;
        simpleLending = ISimpleLending(_simpleLending);
    }

    function setHook(address _hook) external onlyOwner {
        hook = _hook;
    }

    function executeRebalance(PoolKey calldata key, PoolId poolId, uint256) external onlyHook {
        (uint160 sqrtPriceX96, int24 currentTick, , uint24 lpFee, ) = _getPoolState(key, poolId);

        emit PoolStateRetrieved(sqrtPriceX96, currentTick, lpFee);

        uint256 price = _sqrtPriceToPrice(sqrtPriceX96);
        uint256 tick = uint256(int256(currentTick));

        IERC20 collateralToken = simpleLending.collateralToken();
        uint256 collateral = collateralToken.balanceOf(address(simpleLending));
        uint256 debt = address(simpleLending).balance;

        uint256 lowerBound = (tick * TICK_LOWER_BOUND_BPS) / BPS_DENOMINATOR;
        uint256 upperBound = (tick * TICK_UPPER_BOUND_BPS) / BPS_DENOMINATOR;

        uint256 ethWorth = price * (lpFee + debt);
        uint256 usdcWorth = lpFee + collateral;

        if (ethWorth > usdcWorth) {
            uint256 imbalance = ethWorth - usdcWorth;

            if (price >= lowerBound && price <= upperBound) {
                _handleRepayment(poolId, imbalance, price, lpFee, debt, REBALANCE_PERCENTAGE_NORMAL);
            } else if (price > upperBound) {
                _handleRepayment(poolId, imbalance, price, lpFee, debt, REBALANCE_PERCENTAGE_HIGH);
            }
        } else if (usdcWorth > ethWorth && price < lowerBound) {
            uint256 imbalance = usdcWorth - ethWorth;
            _handleBorrowing(poolId, imbalance, price, lpFee, collateral);
        }
    }

    function _handleRepayment(
        PoolId poolId,
        uint256 imbalance,
        uint256 price,
        uint24 lpFee,
        uint256 debt,
        uint256 percentage
    ) internal {
        uint256 repayAmount = ((imbalance * percentage) / BPS_DENOMINATOR) / price;

        if (repayAmount > lpFee) repayAmount = lpFee;
        if (repayAmount > debt) repayAmount = debt;

        if (repayAmount > 0) {
            simpleLending.repay{value: repayAmount}(repayAmount);
            emit RebalanceExecuted(poolId, "REPAY", repayAmount);
        }
    }

    function _handleBorrowing(
        PoolId poolId,
        uint256 imbalance,
        uint256 price,
        uint24 lpFee,
        uint256 collateral
    ) internal {
        uint256 depositAmount = (imbalance * REBALANCE_PERCENTAGE_HIGH) / BPS_DENOMINATOR;

        if (depositAmount > lpFee) depositAmount = lpFee;
        if (depositAmount > collateral) depositAmount = collateral;

        if (depositAmount > 0) {
            IERC20 collateralToken = simpleLending.collateralToken();
            collateralToken.safeTransfer(address(simpleLending), depositAmount);
            simpleLending.borrow(1 * 10 ** 15, price);
            emit RebalanceExecuted(poolId, "BORROW", depositAmount);
        }
    }

    function _getPoolState(
        PoolKey calldata key,
        PoolId poolId
    ) internal view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee, uint128 liquidity) {
        (sqrtPriceX96, tick, protocolFee, lpFee) = StateLibrary.getSlot0(poolManager, poolId);
        liquidity = StateLibrary.getLiquidity(poolManager, poolId);
    }

    function _sqrtPriceToPrice(uint160 sqrtPriceX96) internal pure returns (uint256 price) {
        uint256 priceX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
        price = (priceX192 * 1e18) >> 192;
    }

    receive() external payable {}
}
