// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title PrivacyPoolHook
 * @notice Uniswap V4 hook enabling private swaps through encrypted intents and batch matching
 * @dev Implements the intent matching pattern:
 *      1. Users deposit ERC20 → receive encrypted pool tokens (ERC7984)
 *      2. Users submit encrypted intents (amount + action both encrypted)
 *      3. Relayer matches opposite intents off-chain (with FHE permissions)
 *      4. Settlement: internal transfers (matched) + net AMM swap (unmatched)
 *      5. Users withdraw encrypted tokens → receive ERC20 back
 *
 * Key Features:
 * - Intent Matching: Opposite intents matched internally
 * - Full Privacy: Both amounts (euint64) and actions (euint8) are encrypted
 * - Capital Efficiency: Majority of trades settle without touching AMM
 * - MEV Resistance: Encrypted amounts + actions + batch execution
 * - ERC7984 Standard: Full OpenZeppelin compliance
 *
 * Privacy Model:
 * - Amounts: euint64 (nobody can see trade size)
 * - Actions: euint8 (nobody can see trade direction: 0=swap0→1, 1=swap1→0, etc.)
 * - Only relayer with FHE permissions can decrypt for matching
 *
 * Architecture:
 * - Hook creates PoolEncryptedToken per (pool, currency)
 * - Hook holds all ERC20 reserves backing encrypted tokens 1:1
 * - Settlement updates encrypted balances (gas efficient)
 * - Only net unmatched amounts touch Uniswap AMM
 */

// Uniswap V4
import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";

// Privacy Components
import {PoolEncryptedToken} from "./tokens/PoolEncryptedToken.sol";
import {IntentTypes} from "./libraries/IntentTypes.sol";
import {SettlementLib} from "./libraries/SettlementLib.sol";

// Token & Security
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

// FHE - Zama FHEVM
import {FHE, externalEuint64, euint64, externalEuint8, euint8, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// Oracle & Strategy
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IDeltaZeroStrategy} from "./interfaces/IDeltaZeroStrategy.sol";
import {ISimpleLending} from "./interfaces/ISimpleLending.sol";

contract PrivacyPoolHook is BaseHook, IUnlockCallback, ReentrancyGuardTransient, ZamaEthereumConfig, Ownable2Step {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using CurrencySettler for Currency;

    // =============================================================
    //                           EVENTS
    // =============================================================

    // Critical events only (removed verbose events to reduce contract size)
    event BatchSettled(bytes32 indexed batchId, uint256 internalTransfers, uint128 netAmountIn, uint128 amountOut);
    event PythPriceConsumed(int64 ethPriceUsd, uint256 timestamp);

    error ERR(uint8 code);

    // =============================================================
    //                      STATE VARIABLES
    // =============================================================

    /// @notice Encrypted tokens per pool and currency: poolId => currency => PoolEncryptedToken
    mapping(PoolId => mapping(Currency => PoolEncryptedToken)) public poolEncryptedTokens;

    /// @notice Pool reserves: poolId => IntentTypes.PoolReserves
    mapping(PoolId => IntentTypes.PoolReserves) public poolReserves;

    /// @notice Intent storage: intentId => Intent
    mapping(bytes32 => IntentTypes.Intent) public intents;

    /// @notice Current active batch per pool: poolId => batchId
    mapping(PoolId => bytes32) public currentBatchId;

    /// @notice Batch counter per pool: poolId => counter
    mapping(PoolId => uint64) public batchCounter;

    /// @notice Batch storage: batchId => Batch
    mapping(bytes32 => IntentTypes.Batch) public batches;

    /// @notice Relayer address authorized to settle batches
    address public relayer;

    /// @notice Temporary storage for AMM output during settlement
    uint128 private lastSwapOutput;

    /// @notice Pyth oracle for price feeds
    IPyth public immutable pyth;

    /// @notice Delta zero rebalancing strategy (optional)
    IDeltaZeroStrategy public deltaZeroStrategy;

    /// @notice ETH/USD price feed ID
    bytes32 public constant ETH_USD_PRICE_FEED = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;

    /// @notice SimpleLending protocol for shuttle pattern
    ISimpleLending public simpleLending;

    /// @notice Maximum amount per swap to prevent exploits (per token)
    mapping(Currency => uint256) public maxSwapAmount;

    // =============================================================
    //                     INTERNAL CHECKS
    // =============================================================

    function _checkRelayer() internal view {
        if (msg.sender != relayer) revert ERR(10);
    }

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor(IPoolManager _poolManager, address _relayer, address _pyth) BaseHook(_poolManager) Ownable(msg.sender) {
        if (_relayer == address(0)) revert ERR(11);
        if (_pyth == address(0)) revert ERR(4);

        relayer = _relayer;
        pyth = IPyth(_pyth);
    }

    // =============================================================
    //                      HOOK CONFIGURATION
    // =============================================================

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true, // Enable for liquidity shuttle redeposit
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            });
    }

    // =============================================================
    //                      CORE FUNCTIONS
    // =============================================================

    /**
     * @notice Deposit tokens to receive encrypted tokens for a pool
     * @dev User must approve this contract to spend their tokens first
     * @param key Pool key
     * @param currency Currency to deposit (must be currency0 or currency1)
     * @param amount Amount to deposit
     */
    function deposit(PoolKey calldata key, Currency currency, uint256 amount) external nonReentrant {
        if (amount == 0) revert ERR(5);

        PoolId poolId = key.toId();

        if (address(key.hooks) != address(this)) revert ERR(6);

        if (
            Currency.unwrap(currency) != Currency.unwrap(key.currency0) &&
            Currency.unwrap(currency) != Currency.unwrap(key.currency1)
        ) {
            revert ERR(1);
        }

        // Get or create encrypted token
        PoolEncryptedToken encToken = _getOrCreateEncryptedToken(poolId, currency);

        // Transfer underlying tokens from user to hook
        IERC20(Currency.unwrap(currency)).safeTransferFrom(msg.sender, address(this), amount);

        // Mint encrypted tokens to user
        euint64 encryptedAmount = FHE.asEuint64(uint64(amount));
        FHE.allowThis(encryptedAmount);
        FHE.allow(encryptedAmount, address(encToken));

        encToken.mint(msg.sender, encryptedAmount);

        // Update reserves
        IntentTypes.PoolReserves storage reserves = poolReserves[poolId];
        if (Currency.unwrap(currency) == Currency.unwrap(key.currency0)) {
            reserves.currency0Reserve += amount;
        } else {
            reserves.currency1Reserve += amount;
        }
        reserves.totalDeposits += amount;
    }

    /**
     * @notice Submit an encrypted swap intent with encrypted action
     * @dev Both amount and action are encrypted - full privacy
     * @param key Pool key
     * @param inputCurrency Which currency's encrypted token is being used (currency0 or currency1)
     * @param encAmount Encrypted amount to swap (euint64)
     * @param amountProof Proof for encrypted amount
     * @param encAction Encrypted action (euint8: 0=swap to other token, 1=reverse, etc.)
     * @param actionProof Proof for encrypted action
     * @param deadline Intent expiration (0 = no expiry)
     */
    function submitIntent(
        PoolKey calldata key,
        Currency inputCurrency,
        externalEuint64 encAmount,
        bytes calldata amountProof,
        externalEuint8 encAction,
        bytes calldata actionProof,
        uint64 deadline
    ) external nonReentrant returns (bytes32 intentId) {
        PoolId poolId = key.toId();

        if (
            Currency.unwrap(inputCurrency) != Currency.unwrap(key.currency0) &&
            Currency.unwrap(inputCurrency) != Currency.unwrap(key.currency1)
        ) {
            revert ERR(1);
        }

        // Convert encrypted inputs
        euint64 amount = FHE.fromExternal(encAmount, amountProof);
        euint8 action = FHE.fromExternal(encAction, actionProof);

        FHE.allowThis(amount);
        FHE.allowThis(action);

        PoolEncryptedToken inputToken = poolEncryptedTokens[poolId][inputCurrency];
        if (address(inputToken) == address(0)) revert ERR(3);

        // Grant token contract access and use ERC7984 transfer
        FHE.allow(amount, address(inputToken));

        // Set hook as operator to allow transfer
        inputToken.setOperator(address(this), type(uint48).max);

        // Transfer encrypted tokens from user to hook as collateral
        inputToken.confidentialTransferFrom(msg.sender, address(this), amount);

        // Get or create active batch
        bytes32 batchId = _getOrCreateActiveBatch(poolId);

        // Create intent
        intentId = keccak256(abi.encode(msg.sender, block.timestamp, poolId, amount));

        intents[intentId] = IntentTypes.Intent({
            encryptedAmount: amount,
            encryptedAction: action,
            owner: msg.sender,
            deadline: deadline,
            processed: false,
            poolKey: key,
            batchId: batchId,
            submitTimestamp: block.timestamp
        });

        // Add to batch
        IntentTypes.Batch storage batch = batches[batchId];
        batch.intentIds.push(intentId);
        batch.totalIntents++;

        // Grant relayer access to encrypted data for matching
        FHE.allow(amount, relayer);
        FHE.allow(action, relayer);

        return intentId;
    }

    /**
     * @notice Withdraw encrypted tokens back to ERC20
     * @param key Pool key
     * @param currency Currency to withdraw
     * @param amount Amount to withdraw
     * @param recipient Recipient address
     */
    function withdraw(
        PoolKey calldata key,
        Currency currency,
        uint256 amount,
        address recipient
    ) external nonReentrant {
        if (amount == 0) revert ERR(5);
        if (recipient == address(0)) revert ERR(4);

        PoolId poolId = key.toId();

        PoolEncryptedToken encToken = poolEncryptedTokens[poolId][currency];
        if (address(encToken) == address(0)) revert ERR(3);

        // Create encrypted amount for burning
        euint64 encryptedAmount = FHE.asEuint64(uint64(amount));
        FHE.allowThis(encryptedAmount);
        FHE.allow(encryptedAmount, address(encToken));

        // Burn encrypted tokens from user
        encToken.burn(msg.sender, encryptedAmount);

        // Update reserves
        IntentTypes.PoolReserves storage reserves = poolReserves[poolId];
        if (Currency.unwrap(currency) == Currency.unwrap(key.currency0)) {
            reserves.currency0Reserve -= amount;
        } else {
            reserves.currency1Reserve -= amount;
        }
        reserves.totalWithdrawals += amount;

        // Transfer underlying tokens to recipient
        IERC20(Currency.unwrap(currency)).safeTransfer(recipient, amount);
    }

    // =============================================================
    //                   HOOK IMPLEMENTATIONS
    // =============================================================

    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        if (sender == address(this)) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // Skip shuttle if SimpleLending not configured
        if (address(simpleLending) == address(0)) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // LIQUIDITY SHUTTLE: Withdraw from SimpleLending
        Currency tokenIn = params.zeroForOne ? key.currency0 : key.currency1;

        // Calculate amount needed
        uint256 amountNeeded = params.amountSpecified < 0
            ? uint256(-params.amountSpecified)
            : uint256(params.amountSpecified);

        uint256 limit = maxSwapAmount[tokenIn];
        if (limit > 0 && amountNeeded > limit) {
            revert ERR(14);
        }

        IERC20 token = IERC20(Currency.unwrap(tokenIn));
        uint256 available = simpleLending.getAvailableBalance(token);
        if (available < amountNeeded) {
            revert ERR(15);
        }

        // Withdraw from SimpleLending to hook
        simpleLending.withdraw(token, amountNeeded, address(this));

        // Approve PoolManager to use the withdrawn tokens
        token.forceApprove(address(poolManager), amountNeeded);

        // Return positive delta to provide liquidity to the swap
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(uint128(amountNeeded)), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        // Allow hook-initiated swaps to pass through
        if (sender == address(this)) {
            return (BaseHook.afterSwap.selector, 0);
        }

        // Skip if SimpleLending not configured
        if (address(simpleLending) == address(0)) {
            return (BaseHook.afterSwap.selector, 0);
        }

        // LIQUIDITY SHUTTLE: Redeposit tokens back to SimpleLending
        Currency tokenIn = params.zeroForOne ? key.currency0 : key.currency1;
        Currency tokenOut = params.zeroForOne ? key.currency1 : key.currency0;

        // Check hook's current balance
        IERC20 erc20TokenIn = IERC20(Currency.unwrap(tokenIn));
        IERC20 erc20TokenOut = IERC20(Currency.unwrap(tokenOut));

        uint256 balanceTokenIn = erc20TokenIn.balanceOf(address(this));
        uint256 balanceTokenOut = erc20TokenOut.balanceOf(address(this));

        // Redeposit any remaining tokenIn
        if (balanceTokenIn > 0) {
            erc20TokenIn.forceApprove(address(simpleLending), balanceTokenIn);
            simpleLending.supply(erc20TokenIn, balanceTokenIn);
        }

        // Redeposit received tokenOut
        if (balanceTokenOut > 0) {
            erc20TokenOut.forceApprove(address(simpleLending), balanceTokenOut);
            simpleLending.supply(erc20TokenOut, balanceTokenOut);
        }

        return (BaseHook.afterSwap.selector, 0);
    }

    // =============================================================
    //                    BATCH MANAGEMENT
    // =============================================================

    /**
     * @notice Finalize a batch for processing
     * @dev Can be called by anyone when batch is ready
     * @param poolId Pool ID to finalize batch for
     */
    function finalizeBatch(PoolId poolId) external {
        bytes32 batchId = currentBatchId[poolId];
        if (batchId == bytes32(0)) revert ERR(9);

        IntentTypes.Batch storage batch = batches[batchId];
        if (batch.finalized) revert ERR(17);
        if (batch.totalIntents == 0) revert ERR(18);

        // Mark as finalized
        batch.finalized = true;
        batch.finalizedTimestamp = block.timestamp;

        // Clear current batch for this pool
        currentBatchId[poolId] = bytes32(0);
    }

    /**
     * @notice Settle a batch with internal transfers and net swap
     * @dev Only callable by relayer after off-chain matching
     * @param batchId Batch ID to settle
     * @param internalTransfers Internal matched transfers
     * @param netAmountIn Net amount to swap on AMM
     * @param tokenIn Input token for AMM swap
     * @param tokenOut Output token for AMM swap
     * @param outputToken Encrypted token for output distribution
     * @param userShares User shares for AMM output distribution
     * @param pythPriceUpdate Pyth price update data
     */
    function settleBatch(
        bytes32 batchId,
        IntentTypes.InternalTransfer[] calldata internalTransfers,
        uint128 netAmountIn,
        Currency tokenIn,
        Currency tokenOut,
        address outputToken,
        IntentTypes.UserShare[] calldata userShares,
        bytes calldata pythPriceUpdate
    ) external payable nonReentrant {
        _checkRelayer();
        IntentTypes.Batch storage batch = batches[batchId];
        if (!batch.finalized) revert ERR(7);
        if (batch.settled) revert ERR(8);

        // Get pool key from first intent
        IntentTypes.Intent storage firstIntent = intents[batch.intentIds[0]];
        PoolKey memory key = firstIntent.poolKey;
        PoolId poolId = key.toId();

        // Execute internal transfers (matched intents)
        for (uint256 i = 0; i < internalTransfers.length; i++) {
            _executeInternalTransfer(batchId, internalTransfers[i]);
        }

        // Execute net swap on AMM if needed
        uint128 amountOut = 0;
        if (netAmountIn > 0) {
            // Update Pyth price oracle and consume the price
            int64 ethPriceUsd = _updatePythPrice(pythPriceUpdate);

            // Emit event showing we consumed the price (proof for Pyth bounty)
            if (ethPriceUsd != 0) {
                emit PythPriceConsumed(ethPriceUsd, block.timestamp);
            }

            // Execute net swap
            amountOut = _executeNetSwap(batchId, key, poolId, netAmountIn, tokenIn, tokenOut);

            // Execute delta zero rebalancing strategy if configured
            if (address(deltaZeroStrategy) != address(0)) {
                deltaZeroStrategy.executeRebalance(key, poolId, netAmountIn);
            }

            // Distribute AMM output to users based on shares
            SettlementLib.distributeAMMOutput(outputToken, amountOut, userShares);
        }

        // Mark batch as settled
        batch.settled = true;

        // Mark all intents as processed
        for (uint256 i = 0; i < batch.intentIds.length; i++) {
            intents[batch.intentIds[i]].processed = true;
        }

        emit BatchSettled(batchId, internalTransfers.length, netAmountIn, amountOut);
    }

    // =============================================================
    //                    SETTLEMENT HELPERS
    // =============================================================

    /**
     * @notice Execute internal transfer between users
     * @dev Transfers encrypted tokens without touching AMM
     */
    function _executeInternalTransfer(bytes32 /* batchId */, IntentTypes.InternalTransfer calldata transfer) internal {
        PoolEncryptedToken token = PoolEncryptedToken(transfer.encryptedToken);

        FHE.allow(transfer.encryptedAmount, address(token));

        token.hookTransfer(transfer.from, transfer.to, transfer.encryptedAmount);
    }

    /**
     * @notice Execute net swap on Uniswap AMM
     * @dev Uses unlock callback pattern for atomic swap
     * @return amountOut Amount received from AMM
     */
    function _executeNetSwap(
        bytes32 /* batchId */,
        PoolKey memory key,
        PoolId poolId,
        uint128 amountIn,
        Currency tokenIn,
        Currency tokenOut
    ) internal returns (uint128 amountOut) {
        // Reset last swap output
        lastSwapOutput = 0;

        // Prepare unlock data
        bytes memory unlockData = abi.encode(key, poolId, amountIn, tokenIn, tokenOut);

        // Execute swap via unlock callback
        poolManager.unlock(unlockData);

        // Get output from callback
        amountOut = lastSwapOutput;
        if (amountOut == 0) revert ERR(19);

        return amountOut;
    }

    // =============================================================
    //                      UNLOCK CALLBACK
    // =============================================================

    function unlockCallback(bytes calldata data) external override onlyPoolManager returns (bytes memory) {
        (PoolKey memory key, PoolId poolId, uint128 amount, Currency tokenIn, Currency tokenOut) = abi
            .decode(data, (PoolKey, PoolId, uint128, Currency, Currency));

        // Execute swap via library
        uint128 outputAmount = SettlementLib.executeNetSwap(
            poolManager,
            key,
            poolId,
            amount,
            tokenIn,
            tokenOut,
            poolReserves
        );

        // Store output for settlement
        lastSwapOutput = outputAmount;

        return "";
    }

    // =============================================================
    //                      HELPER FUNCTIONS
    // =============================================================

    /**
     * @notice Get or create encrypted token for pool/currency
     */
    function _getOrCreateEncryptedToken(PoolId poolId, Currency currency) internal returns (PoolEncryptedToken) {
        PoolEncryptedToken existing = poolEncryptedTokens[poolId][currency];

        if (address(existing) == address(0)) {
            // Get symbol for naming
            string memory symbol = _getCurrencySymbol(currency);
            string memory name = string(abi.encodePacked("Encrypted ", symbol));
            string memory tokenSymbol = string(abi.encodePacked("e", symbol));
            string memory tokenURI = "";

            // Create new token
            existing = new PoolEncryptedToken(
                Currency.unwrap(currency),
                PoolId.unwrap(poolId),
                address(this),
                name,
                tokenSymbol,
                tokenURI
            );

            poolEncryptedTokens[poolId][currency] = existing;
        }

        return existing;
    }

    /**
     * @notice Get currency symbol
     */
    function _getCurrencySymbol(Currency currency) internal view returns (string memory) {
        try IERC20Metadata(Currency.unwrap(currency)).symbol() returns (string memory symbol) {
            return symbol;
        } catch {
            return "TOKEN";
        }
    }

    /**
     * @notice Get or create active batch for pool
     */
    function _getOrCreateActiveBatch(PoolId poolId) internal returns (bytes32 batchId) {
        batchId = currentBatchId[poolId];

        if (batchId == bytes32(0) || batches[batchId].finalized) {
            uint64 nextCounter = batchCounter[poolId] + 1;
            batchCounter[poolId] = nextCounter;

            batchId = keccak256(abi.encode(poolId, nextCounter));
            currentBatchId[poolId] = batchId;

            batches[batchId] = IntentTypes.Batch({
                intentIds: new bytes32[](0),
                poolId: PoolId.unwrap(poolId),
                finalized: false,
                settled: false,
                counter: nextCounter,
                totalIntents: 0,
                finalizedTimestamp: 0
            });
        }

        return batchId;
    }

    // =============================================================
    //                     ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Update relayer address
     * @param newRelayer New relayer address
     */
    function updateRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert ERR(11);
        relayer = newRelayer;
    }

    // =============================================================
    //                    PYTH ORACLE INTEGRATION
    // =============================================================

    function _updatePythPrice(bytes calldata pythPriceUpdate) internal returns (int64 ethPrice) {
        if (pythPriceUpdate.length == 0) return 0;

        bytes[] memory priceUpdateData = new bytes[](1);
        priceUpdateData[0] = pythPriceUpdate;

        // 1. PULL: Get update fee
        uint256 fee = pyth.getUpdateFee(priceUpdateData);

        // 2. UPDATE: Update price feeds on-chain
        pyth.updatePriceFeeds{value: fee}(priceUpdateData);

        // 3. CONSUME: Get and use the price
        PythStructs.Price memory price = pyth.getPriceNoOlderThan(ETH_USD_PRICE_FEED, 600);

        // Return the price (in USD with exponent)
        // This price can be used for risk management, slippage protection, etc.
        return price.price;
    }

    function setDeltaZeroStrategy(address strategy) external onlyOwner {
        deltaZeroStrategy = IDeltaZeroStrategy(strategy);
    }

    /**
     * @notice Set SimpleLending for shuttle pattern
     * @param lending Address of SimpleLending contract
     */
    function setSimpleLending(address lending) external {
        require(msg.sender == owner() || msg.sender == relayer, "Not authorized");
        simpleLending = ISimpleLending(lending);
    }

    /**
     * @notice Set maximum swap amount per token (anti-exploit protection)
     * @param token Currency to set limit for
     * @param maxAmount Maximum amount allowed per swap (0 = no limit)
     */
    function setMaxSwapAmount(Currency token, uint256 maxAmount) external onlyOwner {
        maxSwapAmount[token] = maxAmount;
    }

    /**
     * @notice Allow contract to receive ETH for Pyth fees
     */
    receive() external payable {}
}
