// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, euint8} from "@fhevm/solidity/lib/FHE.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/**
 * @title IntentTypes
 * @notice Defines all data structures for the privacy pool intent system
 * @dev Used across PrivacyPoolHook, IntentMatcher, and settlement contracts
 */
library IntentTypes {
    // =============================================================
    //                      ACTION TYPES
    // =============================================================

    /// @notice Encrypted action types (used as euint8 values)
    /// @dev These are the plaintext values, users submit encrypted versions
    uint8 public constant ACTION_SWAP_0_TO_1 = 0; // Swap currency0 → currency1
    uint8 public constant ACTION_SWAP_1_TO_0 = 1; // Swap currency1 → currency0
    uint8 public constant ACTION_ADD_LIQUIDITY = 2; // Add liquidity (future)
    uint8 public constant ACTION_REMOVE_LIQUIDITY = 3; // Remove liquidity (future)
    /**
     * @notice Represents an encrypted swap intent from a user
     * @dev All amounts AND actions remain encrypted until settlement
     * @param encryptedAmount Encrypted amount user wants to swap (euint64 per ERC7984 standard)
     * @param encryptedAction Encrypted action type (euint8: 0=swap0→1, 1=swap1→0, etc.)
     * @param owner User who submitted the intent
     * @param deadline Expiration timestamp (0 = no expiry)
     * @param processed Whether this intent has been settled
     * @param poolKey Pool key for the swap
     * @param batchId Batch this intent belongs to
     * @param submitTimestamp When intent was submitted
     */
    struct Intent {
        euint64 encryptedAmount;
        euint8 encryptedAction;
        address owner;
        uint64 deadline;
        bool processed;
        PoolKey poolKey;
        bytes32 batchId;
        uint256 submitTimestamp;
    }

    /**
     * @notice Batch of intents for processing
     * @dev Batches allow efficient matching and net settlement
     * @param intentIds Array of intent IDs in this batch
     * @param poolId Pool this batch belongs to
     * @param finalized Whether batch is closed for new intents
     * @param settled Whether batch has been executed on-chain
     * @param counter Sequential counter per pool
     * @param totalIntents Number of intents in batch
     * @param finalizedTimestamp When batch was finalized
     */
    struct Batch {
        bytes32[] intentIds;
        bytes32 poolId;
        bool finalized;
        bool settled;
        uint64 counter;
        uint256 totalIntents;
        uint256 finalizedTimestamp;
    }

    /**
     * @notice Internal transfer between users (matched intents)
     * @dev These transfers don't touch the AMM, just update encrypted balances
     * @param from User sending encrypted tokens
     * @param to User receiving encrypted tokens
     * @param encryptedToken Address of the pool's encrypted token (ERC7984)
     * @param encryptedAmount Encrypted amount to transfer (euint64 per ERC7984)
     */
    struct InternalTransfer {
        address from;
        address to;
        address encryptedToken;
        euint64 encryptedAmount;
    }

    /**
     * @notice User's share of AMM output distribution
     * @dev Used to distribute AMM swap output proportionally without revealing individual amounts
     * @param user User address to receive share
     * @param shareNumerator User's share numerator (e.g., 3 for 3/10)
     * @param shareDenominator Total share denominator (e.g., 10 for 3/10)
     */
    struct UserShare {
        address user;
        uint128 shareNumerator;
        uint128 shareDenominator;
    }

    /**
     * @notice Complete settlement instruction for a batch
     * @dev Contains all data needed to settle a batch on-chain
     * @param batchId Batch being settled
     * @param internalTransfers Matched intents settled via encrypted transfers
     * @param netAmountIn Net amount to swap on AMM (after matching)
     * @param tokenIn Input token for AMM swap
     * @param tokenOut Output token for AMM swap
     * @param outputToken Encrypted token to distribute AMM output
     * @param userShares How to distribute AMM output among users
     */
    struct Settlement {
        bytes32 batchId;
        InternalTransfer[] internalTransfers;
        uint128 netAmountIn;
        Currency tokenIn;
        Currency tokenOut;
        address outputToken;
        UserShare[] userShares;
    }

    /**
     * @notice Matching result from intent matcher
     * @dev Internal structure used during matching calculation
     * @param matched Array of matched intent pairs
     * @param unmatched Array of unmatched intents
     * @param netBuy Net buy amount for tokenOut
     * @param netSell Net sell amount for tokenIn
     */
    struct MatchResult {
        bytes32[] matched;
        bytes32[] unmatched;
        uint128 netBuy;
        uint128 netSell;
    }

    /**
     * @notice Pool reserve tracking
     * @dev Tracks how much of each currency the hook holds per pool
     * @param currency0Reserve Amount of currency0 held
     * @param currency1Reserve Amount of currency1 held
     * @param totalDeposits Total deposits made
     * @param totalWithdrawals Total withdrawals made
     */
    struct PoolReserves {
        uint256 currency0Reserve;
        uint256 currency1Reserve;
        uint256 totalDeposits;
        uint256 totalWithdrawals;
    }
}
