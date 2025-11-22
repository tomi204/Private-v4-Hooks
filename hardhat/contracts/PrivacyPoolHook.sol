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
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";

// Privacy Components
import {PoolEncryptedToken} from "./tokens/PoolEncryptedToken.sol";
import {IntentTypes} from "./libraries/IntentTypes.sol";

// Token & Security
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

// FHE - Zama FHEVM
import {FHE, externalEuint64, euint64, externalEuint8, euint8, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrivacyPoolHook is BaseHook, IUnlockCallback, ReentrancyGuardTransient, ZamaEthereumConfig, Ownable2Step {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using CurrencySettler for Currency;

    // =============================================================
    //                           EVENTS
    // =============================================================

    event EncryptedTokenCreated(PoolId indexed poolId, Currency indexed currency, address token, address underlying);

    event Deposited(
        PoolId indexed poolId,
        Currency indexed currency,
        address indexed user,
        uint256 amount,
        address encryptedToken
    );

    event IntentSubmitted(
        PoolId indexed poolId,
        Currency tokenIn,
        Currency tokenOut,
        address indexed user,
        bytes32 indexed intentId,
        bytes32 batchId
    );

    event Withdrawn(
        PoolId indexed poolId,
        Currency indexed currency,
        address indexed user,
        address recipient,
        uint256 amount
    );

    event BatchCreated(bytes32 indexed batchId, PoolId indexed poolId);

    event BatchFinalized(bytes32 indexed batchId, PoolId indexed poolId, uint256 intentCount);

    event BatchSettled(bytes32 indexed batchId, uint256 internalTransfers, uint128 netAmountIn, uint128 amountOut);

    event InternalTransferExecuted(bytes32 indexed batchId, address indexed from, address indexed to, address token);

    event NetSwapExecuted(
        bytes32 indexed batchId,
        PoolId indexed poolId,
        Currency tokenIn,
        Currency tokenOut,
        uint128 amountIn,
        uint128 amountOut
    );

    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    // =============================================================
    //                           ERRORS
    // =============================================================

    error InvalidCurrency();
    error InvalidPair();
    error TokenNotExists();
    error ZeroAddress();
    error ZeroAmount();
    error HookNotEnabled();
    error BatchNotFinalized();
    error BatchAlreadySettled();
    error NoActiveBatch();
    error OnlyRelayer();
    error InvalidRelayer();
    error IntentExpired();
    error IntentAlreadyProcessed();

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

    // =============================================================
    //                         MODIFIERS
    // =============================================================

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert OnlyRelayer();
        _;
    }

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor(IPoolManager _poolManager, address _relayer) BaseHook(_poolManager) Ownable(msg.sender) {
        if (_relayer == address(0)) revert InvalidRelayer();
        relayer = _relayer;
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
                afterSwap: false,
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
        if (amount == 0) revert ZeroAmount();

        PoolId poolId = key.toId();

        // Validate hook is enabled
        if (address(key.hooks) != address(this)) revert HookNotEnabled();

        // Validate currency belongs to pool
        if (
            Currency.unwrap(currency) != Currency.unwrap(key.currency0) &&
            Currency.unwrap(currency) != Currency.unwrap(key.currency1)
        ) {
            revert InvalidCurrency();
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

        emit Deposited(poolId, currency, msg.sender, amount, address(encToken));
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

        // Validate inputCurrency belongs to pool
        if (
            Currency.unwrap(inputCurrency) != Currency.unwrap(key.currency0) &&
            Currency.unwrap(inputCurrency) != Currency.unwrap(key.currency1)
        ) {
            revert InvalidCurrency();
        }

        // Convert encrypted inputs
        euint64 amount = FHE.fromExternal(encAmount, amountProof);
        euint8 action = FHE.fromExternal(encAction, actionProof);

        FHE.allowThis(amount);
        FHE.allowThis(action);

        // Get encrypted token contract
        PoolEncryptedToken inputToken = poolEncryptedTokens[poolId][inputCurrency];
        if (address(inputToken) == address(0)) revert TokenNotExists();

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

        emit IntentSubmitted(poolId, inputCurrency, inputCurrency, msg.sender, intentId, batchId);

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
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        PoolId poolId = key.toId();

        // Get encrypted token
        PoolEncryptedToken encToken = poolEncryptedTokens[poolId][currency];
        if (address(encToken) == address(0)) revert TokenNotExists();

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

        emit Withdrawn(poolId, currency, msg.sender, recipient, amount);
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
        // Allow hook-initiated swaps to pass through
        if (sender == address(this)) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // For external swaps, allow them (hook doesn't block public swaps)
        // This allows the pool to function normally for non-private trades
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
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
        if (batchId == bytes32(0)) revert NoActiveBatch();

        IntentTypes.Batch storage batch = batches[batchId];
        require(!batch.finalized, "Already finalized");
        require(batch.totalIntents > 0, "Empty batch");

        // Mark as finalized
        batch.finalized = true;
        batch.finalizedTimestamp = block.timestamp;

        // Clear current batch for this pool
        currentBatchId[poolId] = bytes32(0);

        emit BatchFinalized(batchId, poolId, batch.totalIntents);
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
     */
    function settleBatch(
        bytes32 batchId,
        IntentTypes.InternalTransfer[] calldata internalTransfers,
        uint128 netAmountIn,
        Currency tokenIn,
        Currency tokenOut,
        address outputToken,
        IntentTypes.UserShare[] calldata userShares
    ) external onlyRelayer nonReentrant {
        IntentTypes.Batch storage batch = batches[batchId];
        if (!batch.finalized) revert BatchNotFinalized();
        if (batch.settled) revert BatchAlreadySettled();

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
            amountOut = _executeNetSwap(batchId, key, poolId, netAmountIn, tokenIn, tokenOut);

            // Distribute AMM output to users based on shares
            _distributeAMMOutput(outputToken, amountOut, userShares);
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
    function _executeInternalTransfer(bytes32 batchId, IntentTypes.InternalTransfer calldata transfer) internal {
        PoolEncryptedToken token = PoolEncryptedToken(transfer.encryptedToken);

        // Grant token access to encrypted amount
        FHE.allow(transfer.encryptedAmount, address(token));

        // Transfer encrypted tokens from → to using hook function
        token.hookTransfer(transfer.from, transfer.to, transfer.encryptedAmount);

        emit InternalTransferExecuted(batchId, transfer.from, transfer.to, transfer.encryptedToken);
    }

    /**
     * @notice Execute net swap on Uniswap AMM
     * @dev Uses unlock callback pattern for atomic swap
     * @return amountOut Amount received from AMM
     */
    function _executeNetSwap(
        bytes32 batchId,
        PoolKey memory key,
        PoolId poolId,
        uint128 amountIn,
        Currency tokenIn,
        Currency tokenOut
    ) internal returns (uint128 amountOut) {
        // Reset last swap output
        lastSwapOutput = 0;

        // Prepare unlock data
        bytes memory unlockData = abi.encode(batchId, key, poolId, amountIn, tokenIn, tokenOut);

        // Execute swap via unlock callback
        poolManager.unlock(unlockData);

        // Get output from callback
        amountOut = lastSwapOutput;
        require(amountOut > 0, "Swap failed");

        emit NetSwapExecuted(batchId, poolId, tokenIn, tokenOut, amountIn, amountOut);

        return amountOut;
    }

    /**
     * @notice Distribute AMM output to users based on shares
     * @dev Mints encrypted tokens proportionally to users
     */
    function _distributeAMMOutput(
        address outputTokenAddress,
        uint128 totalOutput,
        IntentTypes.UserShare[] calldata userShares
    ) internal {
        PoolEncryptedToken outputToken = PoolEncryptedToken(outputTokenAddress);

        for (uint256 i = 0; i < userShares.length; i++) {
            IntentTypes.UserShare calldata share = userShares[i];

            // Calculate user's portion: (totalOutput * numerator) / denominator
            uint64 userAmount = uint64(
                (uint256(totalOutput) * uint256(share.shareNumerator)) / uint256(share.shareDenominator)
            );

            // Create encrypted amount and mint
            euint64 encAmount = FHE.asEuint64(userAmount);
            FHE.allowThis(encAmount);
            FHE.allow(encAmount, address(outputToken));

            outputToken.mint(share.user, encAmount);
        }
    }

    // =============================================================
    //                      UNLOCK CALLBACK
    // =============================================================

    function unlockCallback(bytes calldata data) external override onlyPoolManager returns (bytes memory) {
        (bytes32 batchId, PoolKey memory key, PoolId poolId, uint128 amount, Currency tokenIn, Currency tokenOut) = abi
            .decode(data, (bytes32, PoolKey, PoolId, uint128, Currency, Currency));

        // Determine swap direction
        bool zeroForOne = Currency.unwrap(tokenIn) == Currency.unwrap(key.currency0);

        // Execute swap with exact input
        SwapParams memory swapParams = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(uint256(amount)), // Negative for exact input
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        BalanceDelta delta = poolManager.swap(key, swapParams, "");

        // Read deltas
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();

        // Settle what we owe (negative), take what we're owed (positive)
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

        // Calculate output amount
        uint128 outputAmount;
        if (Currency.unwrap(tokenOut) == Currency.unwrap(key.currency0)) {
            require(d0 > 0, "No token0 output");
            outputAmount = uint128(d0);
        } else {
            require(d1 > 0, "No token1 output");
            outputAmount = uint128(d1);
        }

        // Update reserves
        IntentTypes.PoolReserves storage reserves = poolReserves[poolId];
        if (Currency.unwrap(tokenIn) == Currency.unwrap(key.currency0)) {
            reserves.currency0Reserve -= amount;
            reserves.currency1Reserve += outputAmount;
        } else {
            reserves.currency1Reserve -= amount;
            reserves.currency0Reserve += outputAmount;
        }

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

            emit EncryptedTokenCreated(poolId, currency, address(existing), Currency.unwrap(currency));
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

            emit BatchCreated(batchId, poolId);
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
        if (newRelayer == address(0)) revert InvalidRelayer();

        address oldRelayer = relayer;
        relayer = newRelayer;

        emit RelayerUpdated(oldRelayer, newRelayer);
    }

    // =============================================================
    //                       VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Get batch info
     */
    function getBatch(bytes32 batchId) external view returns (IntentTypes.Batch memory) {
        return batches[batchId];
    }

    /**
     * @notice Get intent info
     */
    function getIntent(bytes32 intentId) external view returns (IntentTypes.Intent memory) {
        return intents[intentId];
    }

    /**
     * @notice Get pool reserves
     */
    function getPoolReserves(PoolId poolId) external view returns (IntentTypes.PoolReserves memory) {
        return poolReserves[poolId];
    }

    /**
     * @notice Get encrypted token for pool/currency
     */
    function getEncryptedToken(PoolId poolId, Currency currency) external view returns (address) {
        return address(poolEncryptedTokens[poolId][currency]);
    }

    /**
     * @notice Get current batch ID for pool
     */
    function getCurrentBatchId(PoolId poolId) external view returns (bytes32) {
        return currentBatchId[poolId];
    }
}
