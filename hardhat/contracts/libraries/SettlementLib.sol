// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {PoolEncryptedToken} from "../tokens/PoolEncryptedToken.sol";
import {IntentTypes} from "./IntentTypes.sol";

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";

library SettlementLib {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using CurrencySettler for Currency;

    error ERR(uint8 code);

    function executeNetSwap(
        IPoolManager poolManager,
        PoolKey memory key,
        PoolId poolId,
        uint128 amountIn,
        Currency tokenIn,
        Currency tokenOut,
        mapping(PoolId => IntentTypes.PoolReserves) storage poolReserves
    ) external returns (uint128 amountOut) {
        bool zeroForOne = Currency.unwrap(tokenIn) == Currency.unwrap(key.currency0);

        SwapParams memory swapParams = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(uint256(amountIn)),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        BalanceDelta delta = poolManager.swap(key, swapParams, "");

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();

        if (d0 < 0) {
            key.currency0.settle(poolManager, address(this), uint128(-d0), false);
        }
        if (d1 < 0) {
            key.currency1.settle(poolManager, address(this), uint128(-d1), false);
        }
        if (d0 > 0) {
            key.currency0.take(poolManager, address(this), uint128(d0), false);
        }
        if (d1 > 0) {
            key.currency1.take(poolManager, address(this), uint128(d1), false);
        }

        uint128 outputAmount;
        if (Currency.unwrap(tokenOut) == Currency.unwrap(key.currency0)) {
            if (d0 <= 0) revert ERR(20);
            outputAmount = uint128(d0);
        } else {
            if (d1 <= 0) revert ERR(21);
            outputAmount = uint128(d1);
        }

        IntentTypes.PoolReserves storage reserves = poolReserves[poolId];
        if (Currency.unwrap(tokenIn) == Currency.unwrap(key.currency0)) {
            reserves.currency0Reserve -= amountIn;
            reserves.currency1Reserve += outputAmount;
        } else {
            reserves.currency1Reserve -= amountIn;
            reserves.currency0Reserve += outputAmount;
        }

        return outputAmount;
    }

    function distributeAMMOutput(
        address outputTokenAddress,
        uint128 totalOutput,
        IntentTypes.UserShare[] calldata userShares
    ) external {
        PoolEncryptedToken outputToken = PoolEncryptedToken(outputTokenAddress);

        for (uint256 i = 0; i < userShares.length; i++) {
            IntentTypes.UserShare calldata share = userShares[i];

            uint64 userAmount = uint64(
                (uint256(totalOutput) * uint256(share.shareNumerator)) / uint256(share.shareDenominator)
            );

            euint64 encAmount = FHE.asEuint64(userAmount);
            FHE.allowThis(encAmount);
            FHE.allow(encAmount, address(outputToken));

            outputToken.mint(share.user, encAmount);
        }
    }
}
