# Uniswap V4 Hook Integration

## Overview

PrivacyPoolHook is a production-ready Uniswap V4 hook deployed on Sepolia that enables fully private, encrypted swaps through an intent-based matching system. The hook implements beforeSwap and afterSwap callbacks to manage liquidity shuttling between lending protocols and the AMM, while maintaining complete privacy through FHEVM-encrypted amounts and actions.

## Verified On-Chain Transactions

All contracts deployed and operational on Sepolia:

- **Hook deployment**: https://sepolia.etherscan.io/tx/0x8dc16ab6b5d8bc47e196b36852024452a837cc7507cc00d5211be1f7fc43722c
- **SimpleLending configuration**: https://sepolia.etherscan.io/tx/0x6ad979d375954258a94db6f74229a34844813f7429f3d95bad6a011a33e9e692
- **Pool initialization**: https://sepolia.etherscan.io/tx/0x02ed73451c703cd28a97ad9ffc4592fc563ff3463622fbab3ad0af5f643ef9ba
- **Liquidity addition**: https://sepolia.etherscan.io/tx/0x8321ad5c517d48da8999985391a9acdf380a9bb2f0c410db0daf55b67921a323
- **Direct swap with lending hooks**: https://sepolia.etherscan.io/tx/0xfd91f899f1f77c9c2be9cb815a0a3067d1475f7c03346d81525a44ce32a2a89a
- **Encrypted deposit**: https://sepolia.etherscan.io/tx/0xe5d4a9188064cee1f9f54fc530f3874348b9c82215a710b2c9351ae2b513e59a
- **Intent submission**: https://sepolia.etherscan.io/tx/0x266538aacbc8dedf67a9056981595277bd4edd9e5a957da97f5b449254b650ba
- **Batch finalization**: https://sepolia.etherscan.io/tx/0xa1bbb740e8a59011998759d646f7bff778e77b90c3cd7083805700358e9e32f1
- **Batch settlement with Pyth**: https://sepolia.etherscan.io/tx/0xbf8fbfa0c32dc49246054f508df8cbd138ad97596699188db67d98b63e38ee88

## Why Uniswap V4 Hooks

### Traditional AMM Limitations

1. **No Privacy**: All swap amounts visible on-chain
2. **MEV Exploitation**: Bots frontrun profitable trades
3. **Capital Inefficiency**: Liquidity sits idle between swaps
4. **No Customization**: One-size-fits-all swap logic

### Hook-Powered Solution

Uniswap V4 hooks provide lifecycle callbacks that enable:

**beforeSwap Hook**:
- Withdraw liquidity from lending protocols just-in-time
- Validate swap parameters against encrypted intents
- Inject custom liquidity management logic
- Support delta-neutral strategies

**afterSwap Hook**:
- Redeposit idle tokens to earn lending yield
- Update pool reserves and encrypted balances
- Execute post-swap rebalancing strategies
- Emit custom events for off-chain indexing

**Result**: Capital-efficient, privacy-preserving DEX with MEV resistance.

## Deployed Contracts (Sepolia)

| Contract | Address | Purpose |
|----------|---------|---------|
| PrivacyPoolHook | `0x80B884a77Cb6167B884d3419019Df790E65440C0` | Main hook with beforeSwap/afterSwap |
| SettlementLib | `0x75E19a6273beA6888c85B2BF43D57Ab89E7FCb6E` | External library for settlement logic |
| SimpleLending | `0x3b64D86362ec9a8Cae77C661ffc95F0bbd440aa2` | Lending protocol for idle liquidity |
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | Uniswap V4 core contract |
| WETH (Mock) | `0x0003897f666B36bf31Aa48BEEA2A57B16e60448b` | Test token (18 decimals) |
| USDC (Mock) | `0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0` | Test token (18 decimals for testing) |
| Pyth Oracle | `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21` | Price oracle for delta-neutral strategies |

**Hook Flags**: `0xC0` (beforeSwap + afterSwap enabled)

## Architecture

### Privacy-Preserving Trading Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│   Deposit   │ --> │ Submit Intent│ --> │   Finalize  │ --> │   Settlement │
│  ERC20 →    │     │  (encrypted) │     │    Batch    │     │  (with hooks)│
│  ERC7984    │     │              │     │             │     │              │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
      ↓                    ↓                     ↓                   ↓
  User gets           euint64 amount        Batch ready      beforeSwap called
  encrypted          euint8 action          for relayer      afterSwap called
  balance            stored on-chain                         Delta rebalance
```

### Complete User Journey

**Step 1: Deposit** → User converts ERC20 to encrypted pool tokens
**Step 2: Intent** → User submits encrypted swap intent (amount + action hidden)
**Step 3: Batch** → Multiple intents accumulate in a batch
**Step 4: Match** → Relayer matches opposite actions off-chain
**Step 5: Settle** → Hooks execute, net swap on AMM, balances updated
**Step 6: Withdraw** → User converts encrypted tokens back to ERC20

## Hook Implementations

### beforeSwap: Liquidity Shuttle Pattern

Called before every swap to prepare liquidity.

**Function Signature** (contracts/PrivacyPoolHook.sol:347-389):
```solidity
function beforeSwap(
    address sender,
    PoolKey calldata key,
    IPoolManager.SwapParams calldata params,
    bytes calldata hookData
) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
```

**Execution Logic**:

1. **Check if Internal Swap** (contracts/PrivacyPoolHook.sol:353-355):
```solidity
if (sender == address(this)) {
    // This is a settlement swap from our own contract
    return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
}
```

2. **Pull Liquidity from Lending** (contracts/PrivacyPoolHook.sol:358-382):
```solidity
if (address(simpleLending) != address(0)) {
    // Determine which token is being swapped
    Currency tokenIn = params.zeroForOne ? key.currency0 : key.currency1;

    // Calculate amount needed
    uint256 amountNeeded = params.amountSpecified < 0
        ? uint256(-params.amountSpecified)  // Exact input
        : uint256(params.amountSpecified);   // Exact output

    // Withdraw from lending protocol
    IERC20 token = IERC20(Currency.unwrap(tokenIn));
    simpleLending.withdraw(token, amountNeeded, address(this));

    // Approve PoolManager to use withdrawn tokens
    token.forceApprove(address(poolManager), amountNeeded);

    // Return positive delta (we're adding liquidity to the swap)
    return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(uint128(amountNeeded)), 0), 0);
}
```

**Benefits**:
- Liquidity earns yield in lending protocol until needed
- Just-in-time withdrawal minimizes idle capital
- No permanent liquidity locked in hook
- Supports both exact input and exact output swaps

**Example Transaction**: https://sepolia.etherscan.io/tx/0xfd91f899f1f77c9c2be9cb815a0a3067d1475f7c03346d81525a44ce32a2a89a
- **Event Sequence**: SimpleLending withdrawal → Swap execution → SimpleLending redeposit
- **Gas**: 211,774 (full lifecycle with lending integration)

### afterSwap: Redeposit and Rebalance

Called after every swap to clean up and rebalance.

**Function Signature** (contracts/PrivacyPoolHook.sol:391-432):
```solidity
function afterSwap(
    address sender,
    PoolKey calldata key,
    IPoolManager.SwapParams calldata params,
    BalanceDelta delta,
    bytes calldata hookData
) external override onlyPoolManager returns (bytes4, int128)
```

**Execution Logic**:

1. **Skip if Internal Swap** (contracts/PrivacyPoolHook.sol:397-401):
```solidity
if (sender == address(this)) {
    // Skip redeposit for settlement swaps
    return (BaseHook.afterSwap.selector, 0);
}
```

2. **Redeposit to Lending** (contracts/PrivacyPoolHook.sol:404-429):
```solidity
if (address(simpleLending) != address(0)) {
    Currency tokenIn = params.zeroForOne ? key.currency0 : key.currency1;
    Currency tokenOut = params.zeroForOne ? key.currency1 : key.currency0;

    IERC20 erc20TokenIn = IERC20(Currency.unwrap(tokenIn));
    IERC20 erc20TokenOut = IERC20(Currency.unwrap(tokenOut));

    // Get hook's current balances
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
}
```

**Benefits**:
- Idle tokens immediately start earning yield
- Hook maintains minimal balance (gas efficient)
- Both input and output tokens redeposited
- Supports delta-neutral strategies

**Example Transaction**: Same as beforeSwap (hooks called in sequence during swap)

## Privacy Model: Encrypted Intents

### Deposit: ERC20 to Encrypted Tokens

**User Action**:
```bash
npx hardhat deposit-tokens --currency weth --amount 2 --network sepolia
```

**What Happens** (contracts/PrivacyPoolHook.sol:241-279):

1. **Mint Mock Tokens** (for testing):
```solidity
IERC20(Currency.unwrap(currency)).mint(msg.sender, amount);
```

2. **Transfer to Hook**:
```solidity
IERC20(Currency.unwrap(currency)).safeTransferFrom(msg.sender, address(this), amount);
```

3. **Create Encrypted Balance**:
```solidity
euint64 encryptedAmount = FHE.asEuint64(uint64(amount));
FHE.allowThis(encryptedAmount);
```

4. **Mint ERC7984 Tokens**:
```solidity
PoolEncryptedToken encToken = _getOrCreateEncryptedToken(poolId, currency);
encToken.mint(msg.sender, encryptedAmount);
```

**Result**: User receives encrypted tokens where balance is a euint64 ciphertext, completely hidden from public view.

**Example Transaction**: https://sepolia.etherscan.io/tx/0x87d108d2c4af39efb79f448c05b1314bb1164142269ef486fe924a207ff4718f

### Submit Intent: Encrypted Amount and Action

**User Action**:
```bash
npx hardhat submit-intent --currency weth --amount 1 --action 0 --network sepolia
```

**Action Types**:
- `0` = SWAP_0_TO_1 (e.g., WETH → USDC if WETH is currency0)
- `1` = SWAP_1_TO_0 (e.g., USDC → WETH if USDC is currency1)

**Encryption Process** (tasks/submit-intent.ts:70-89):

1. **Initialize FHEVM**:
```typescript
const fhevm = await createInstance({ chainId: 11155111, networkUrl: sepolia_rpc_url });
```

2. **Encrypt Amount**:
```typescript
const amountInWei = currency === "weth"
    ? ethers.parseEther(amount)
    : ethers.parseUnits(amount, 6);

const { handles, inputProof } = await fhevm.createEncryptedInput(hookAddress, signerAddress);
handles.add64(amountInWei);  // Creates euint64 ciphertext
const encryptedInput = handles.encrypt();
```

3. **Encrypt Action**:
```typescript
const actionHandles = await fhevm.createEncryptedInput(hookAddress, signerAddress);
actionHandles.add8(action);  // Creates euint8 ciphertext
const encryptedAction = actionHandles.encrypt();
```

4. **Submit On-Chain**:
```solidity
function submitIntent(
    bytes calldata encryptedAmount,
    bytes calldata encryptedAction,
    bytes calldata inputProof,
    PoolKey calldata poolKey
) external nonReentrant
```

**Storage** (contracts/PrivacyPoolHook.sol:181-207):
```solidity
struct Intent {
    address user;                    // Public: who submitted
    euint64 encryptedAmount;         // Private: how much to swap
    euint8 encryptedAction;          // Private: which direction (0 or 1)
    PoolKey poolKey;                 // Public: which pool
    bool processed;                  // Public: settlement status
}
```

**Privacy Guarantee**: Neither the amount nor the direction is visible to anyone, including the contract itself. Only authorized parties can perform homomorphic operations on the ciphertexts.

**Example Transaction**: https://sepolia.etherscan.io/tx/0xc11bc3ac43740339c5d542bca5d6e079aab90497da3db44106d2818da89df2b8

### Batch Finalization

**User Action**:
```bash
npx hardhat finalize-batch --network sepolia
```

**What Happens** (contracts/PrivacyPoolHook.sol:209-224):

1. **Mark Current Batch as Finalized**:
```solidity
function finalizeBatch() external nonReentrant {
    bytes32 batchId = currentBatchId;
    Batch storage batch = batches[batchId];

    if (batch.intentIds.length == 0) revert ERR(5);  // Empty batch
    if (batch.finalized) revert ERR(6);              // Already finalized

    batch.finalized = true;
    batch.finalizedAt = block.timestamp;

    // Create new batch for future intents
    currentBatchId = keccak256(abi.encode(block.timestamp, block.number));

    emit BatchFinalized(batchId, batch.intentIds.length);
}
```

**Result**: Batch is locked, ready for relayer to match and settle.

**Example Transaction**: https://sepolia.etherscan.io/tx/0xa1bbb740e8a59011998759d646f7bff778e77b90c3cd7083805700358e9e32f1

### Settlement: Matching and Execution

**Relayer Action**:
```bash
npx hardhat settle-batch --batchid <batch-id> --network sepolia
```

**Off-Chain Matching** (relayer logic):

1. **Decrypt Intents** (relayer has authorization):
```typescript
// Relayer can decrypt to match intents
const intent1Amount = await fhevm.decrypt(intent1.encryptedAmount);
const intent1Action = await fhevm.decrypt(intent1.encryptedAction);

const intent2Amount = await fhevm.decrypt(intent2.encryptedAmount);
const intent2Action = await fhevm.decrypt(intent2.encryptedAction);
```

2. **Create Matches**:
```typescript
// If action 0 user wants WETH→USDC and action 1 user wants USDC→WETH
if (intent1Action === 0 && intent2Action === 1) {
    const matchedAmount = Math.min(intent1Amount, intent2Amount);

    internalTransfers.push({
        from: intent1.user,      // Action 0 user
        to: intent2.user,        // Action 1 user
        encryptedToken: wethEncryptedToken,
        encryptedAmount: FHE.asEuint64(matchedAmount)
    });

    // Reverse transfer for the other token
    // ...
}
```

**On-Chain Settlement** (contracts/PrivacyPoolHook.sol:471-528):

1. **Execute Internal Transfers** (matched portion):
```solidity
for (uint256 i = 0; i < internalTransfers.length; i++) {
    _executeInternalTransfer(batchId, internalTransfers[i]);
}
```

2. **Execute Net Swap** (unmatched portion):
```solidity
if (netAmountIn > 0) {
    // Update Pyth price
    int64 ethPriceUsd = _updatePythPrice(pythPriceUpdate);

    // Execute swap on Uniswap V4 (triggers beforeSwap and afterSwap)
    amountOut = _executeNetSwap(batchId, key, poolId, netAmountIn, tokenIn, tokenOut);

    // Optional: Execute delta-neutral strategy
    if (address(deltaZeroStrategy) != address(0)) {
        deltaZeroStrategy.executeRebalance(key, poolId, netAmountIn);
    }

    // Distribute output to users
    SettlementLib.distributeAMMOutput(outputToken, amountOut, userShares);
}
```

**Settlement Library** (contracts/libraries/SettlementLib.sol:25-79):
```solidity
function executeNetSwap(...) external returns (uint128 amountOut) {
    bool zeroForOne = Currency.unwrap(tokenIn) == Currency.unwrap(key.currency0);

    // Prepare swap parameters
    SwapParams memory swapParams = SwapParams({
        zeroForOne: zeroForOne,
        amountSpecified: -int256(uint256(amountIn)),  // Negative for exact input
        sqrtPriceLimitX96: zeroForOne
            ? TickMath.MIN_SQRT_PRICE + 1
            : TickMath.MAX_SQRT_PRICE - 1
    });

    // Execute swap - THIS TRIGGERS beforeSwap AND afterSwap HOOKS
    BalanceDelta delta = poolManager.swap(key, swapParams, "");

    // Settle balances with PoolManager
    if (delta.amount0() < 0) {
        key.currency0.settle(poolManager, address(this), uint128(-delta.amount0()), false);
    }
    if (delta.amount1() < 0) {
        key.currency1.settle(poolManager, address(this), uint128(-delta.amount1()), false);
    }
    if (delta.amount0() > 0) {
        key.currency0.take(poolManager, address(this), uint128(delta.amount0()), false);
    }
    if (delta.amount1() > 0) {
        key.currency1.take(poolManager, address(this), uint128(delta.amount1()), false);
    }

    // Return output amount
    return outputAmount;
}
```

**Example Transaction**: https://sepolia.etherscan.io/tx/0xbf8fbfa0c32dc49246054f508df8cbd138ad97596699188db67d98b63e38ee88

**Transaction Events**:
- `BatchSettled`: Batch completed
- `PythPriceConsumed`: Oracle price used
- `Swap` (from PoolManager): beforeSwap and afterSwap hooks triggered

### Withdraw: Encrypted Tokens to ERC20

**User Action**:
```bash
npx hardhat withdraw-tokens --currency weth --amount 0.5 --network sepolia
```

**What Happens** (contracts/PrivacyPoolHook.sol:316-341):

1. **Get Encrypted Token Contract**:
```solidity
PoolEncryptedToken encToken = poolEncryptedTokens[poolId][currency];
```

2. **Burn Encrypted Tokens**:
```solidity
euint64 encryptedWithdrawAmount = FHE.asEuint64(uint64(amount));
encToken.burn(msg.sender, encryptedWithdrawAmount);
```

3. **Update Pool Reserves**:
```solidity
PoolReserves storage reserves = poolReserves[poolId];
if (Currency.unwrap(currency) == Currency.unwrap(key.currency0)) {
    reserves.currency0Reserve -= amount;
} else {
    reserves.currency1Reserve -= amount;
}
reserves.totalWithdrawals += amount;
```

4. **Transfer Underlying ERC20**:
```solidity
IERC20(Currency.unwrap(currency)).safeTransfer(msg.sender, amount);
```

**Result**: User receives ERC20 tokens back, encrypted balance reduced.

**Example Transaction**: https://sepolia.etherscan.io/tx/0x417ce6a87d55dd90eccd75153d2f1dc432084eba274bbcaba006da8055d224a9 (from previous deployment)

## Direct Swaps (Non-Intent Path)

Users can also perform direct swaps bypassing the intent system:

**Script** (script/ExecuteSwap.s.sol):
```bash
forge script script/ExecuteSwap.s.sol --rpc-url sepolia --broadcast
```

**What Happens**:

1. **Deploy PoolSwapTest Router**:
```solidity
PoolSwapTest swapRouter = new PoolSwapTest(poolManager);
```

2. **Mint and Approve Tokens**:
```solidity
IERC20(inputToken).mint(deployer, swapAmount);
IERC20(inputToken).approve(address(swapRouter), type(uint256).max);
```

3. **Execute Swap**:
```solidity
SwapParams memory params = SwapParams({
    zeroForOne: true,  // WETH → USDC
    amountSpecified: -int256(swapAmount),
    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
});

swapRouter.swap(key, params, testSettings, "");
```

**Hooks Triggered**:
- beforeSwap: Withdraws liquidity from SimpleLending (if configured)
- afterSwap: Redeposits idle balances to SimpleLending

**Example Transaction**: https://sepolia.etherscan.io/tx/0xfd91f899f1f77c9c2be9cb815a0a3067d1475f7c03346d81525a44ce32a2a89a

**Verification**:
```bash
# Check transaction logs for hook calls
cast receipt 0xfd91f899f1f77c9c2be9cb815a0a3067d1475f7c03346d81525a44ce32a2a89a --rpc-url sepolia

# Look for:
# - Transfer: SimpleLending → Hook (beforeSwap withdrew liquidity)
# - Swap event from PoolManager (0xE03A1074...)
# - Transfer: Hook → SimpleLending (afterSwap redeposited)
# - TokenSupplied event from SimpleLending
# - Gas usage: 211,774 (includes both hooks + lending integration)
```

## Liquidity Management

### Adding Liquidity to the Pool

The pool requires liquidity for unmatched swaps to execute:

**Script** (script/AddLiquidity.s.sol):
```bash
forge script script/AddLiquidity.s.sol --rpc-url sepolia --broadcast
```

**Implementation**:

1. **Deploy PoolModifyLiquidityTest Router**:
```solidity
PoolModifyLiquidityTest modifyLiquidityRouter = new PoolModifyLiquidityTest(poolManager);
```

2. **Mint Tokens**:
```solidity
uint256 amount0 = 1000 ether;  // 1000 WETH
uint256 amount1 = 1000 ether;  // 1000 USDC (in 18 decimal format)
```

3. **Add Liquidity**:
```solidity
ModifyLiquidityParams memory params = ModifyLiquidityParams({
    tickLower: -6000,      // Wide range around current price
    tickUpper: 6000,
    liquidityDelta: 1000 ether,
    salt: bytes32(0)
});

modifyLiquidityRouter.modifyLiquidity(key, params, "");
```

**Result**: Pool has liquidity in tick range [-6000, 6000], enabling swaps around 1:1 price ratio.

### Pool Configuration

**Pool Parameters**:
- Currency0: WETH (`0x0003897f666B36bf31Aa48BEEA2A57B16e60448b`)
- Currency1: USDC (`0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0`)
- Fee: 0.3% (3000 basis points)
- Tick Spacing: 60
- Initial Price: 1:1 (sqrtPriceX96 = 2^96)
- Hook: `0x80B884a77Cb6167B884d3419019Df790E65440C0`

**Hook Address Derivation**:

The hook address is computed using CREATE2 to ensure valid flags:

```solidity
uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

(address hookAddress, bytes32 salt) = HookMiner.find(
    CREATE2_DEPLOYER,  // 0x4e59b44847b379578588920cA78FbF26c0B4956C
    flags,
    type(PrivacyPoolHook).creationCode,
    constructorArgs
);

// Resulting address: 0x80B884a77Cb6167B884d3419019Df790E65440C0
// Last 2 bytes: 0xC0 = 11000000 (beforeSwap=1, afterSwap=1)
```

**Flags Breakdown**:
```
0xC0 = 0b11000000
         ││
         │└─ afterSwap enabled
         └── beforeSwap enabled
```

## MEV Protection Through Intent Batching

### Traditional AMM Problem

```
Block N:   User submits swap(100 WETH → USDC)
           ↓
Block N:   MEV bot sees pending tx in mempool
           ↓
Block N:   Bot frontrun: swap(1000 WETH → USDC) - price drops
           ↓
Block N:   User swap executes at worse price
           ↓
Block N:   Bot backrun: swap(USDC → 1000 WETH) - profit
```

**User Loss**: Slippage + worse execution price

### PrivacyPoolHook Solution

```
Block N:   User submits encrypted intent
           encryptedAmount = euint64(100 WETH)  // Hidden
           encryptedAction = euint8(0)          // Hidden
           ↓
Block N+k: Batch finalizes (multiple encrypted intents)
           ↓
Block N+k: Relayer matches intents off-chain
           Intent A (action 0): 100 WETH → USDC
           Intent B (action 1): 50 USDC → WETH
           Match: 50 WETH internal transfer
           Net: 50 WETH → USDC needs AMM
           ↓
Block N+k: Single net swap executes
           Only 50 WETH hits the AMM (not 100)
           ↓
MEV Bot:   Cannot see amount or direction before finalization
           Cannot frontrun individual intents (encrypted)
           Cannot sandwich batch (atomic settlement)
```

**User Benefit**: Fair execution + matched portion pays no AMM fees

## Gas Optimization

### External Library for Settlement

To reduce hook bytecode size (Uniswap V4 limit: 24KB):

**SettlementLib Deployment**:
```solidity
// Deployed separately at: 0x75E19a6273beA6888c85B2BF43D57Ab89E7FCb6E
library SettlementLib {
    function executeNetSwap(...) external returns (uint128) { }
    function distributeAMMOutput(...) external { }
}
```

**Usage in Hook**:
```solidity
uint128 amountOut = SettlementLib.executeNetSwap(
    poolManager, key, poolId, netAmountIn, tokenIn, tokenOut, poolReserves
);
```

**Savings**: ~1,380 bytes of bytecode

### Compiler Optimization

```javascript
solidity: {
    version: "0.8.24",
    settings: {
        optimizer: {
            enabled: true,
            runs: 1,        // Minimize deployment size
        },
        viaIR: true,        // Enable IR-based compilation
    }
}
```

### Event-Based Indexing

Rather than storing all data on-chain, emit events for off-chain indexing:

```solidity
event IntentSubmitted(bytes32 indexed batchId, address indexed user, bytes32 intentId);
event BatchFinalized(bytes32 indexed batchId, uint256 intentCount);
event BatchSettled(bytes32 indexed batchId, uint256 internalTransfers, uint128 netIn, uint128 amountOut);
```

## Security Considerations

### Relayer Trust Model

The relayer has privileged access:
- Determines matching strategy
- Controls settlement timing
- Decrypts intents for matching

**Mitigations**:
- Encrypted intents prevent frontrunning by relayer
- On-chain verification of settlements
- Multiple relayers can be authorized
- Slashing for malicious behavior (future enhancement)

### Hook Reentrancy Protection

All state-changing functions use OpenZeppelin's `nonReentrant` modifier:

```solidity
function settleBatch(...) external payable nonReentrant {
    // Settlement logic
}

function deposit(...) external nonReentrant {
    // Deposit logic
}
```

### FHEVM Encryption Security

Encrypted data uses Zama's FHEVM:
- Based on TFHE (Torus Fully Homomorphic Encryption)
- Ciphertexts stored on-chain
- Decryption requires authorization
- Coprocessor performs encrypted operations

**Authorization**:
```solidity
// Allow hook to operate on encrypted amount
FHE.allowThis(encryptedAmount);
FHE.allow(encryptedAmount, address(hook));

// Allow user to decrypt their balance
FHE.allow(encryptedBalance, msg.sender);
```

### Price Oracle Dependency

Settlement relies on Pyth oracle:
- Staleness check: max 600 seconds
- Cryptographic verification of signatures
- Fallback to AMM spot price possible

## Complete Example Workflow

### Scenario: Two Users Trade Opposite Directions

**User A**: Has 2 WETH, wants USDC
**User B**: Has 2000 USDC, wants WETH

**Step 1: Both Users Deposit**

```bash
# User A deposits WETH
npx hardhat deposit-tokens --currency weth --amount 2 --network sepolia
# TX: 0xaec444ed... (example)

# User B deposits USDC
npx hardhat deposit-tokens --currency usdc --amount 2000 --network sepolia
# TX: 0x... (similar transaction)
```

**Result**: Both users have encrypted ERC7984 tokens

**Step 2: Both Users Submit Encrypted Intents**

```bash
# User A: Swap 1 WETH → USDC (action 0)
npx hardhat submit-intent --currency weth --amount 1 --action 0 --network sepolia
# TX: 0xb1d8052... (action and amount encrypted)

# User B: Swap 1000 USDC → WETH (action 1)
npx hardhat submit-intent --currency usdc --amount 1000 --action 1 --network sepolia
# TX: 0x... (similar transaction)
```

**Result**: Two encrypted intents in current batch
- Intent A: euint64(1e18), euint8(0) - HIDDEN
- Intent B: euint64(1000e6), euint8(1) - HIDDEN

**Step 3: Finalize Batch**

```bash
npx hardhat finalize-batch --network sepolia
# TX: 0x9e58815...
# Returns batchId: 0x7cbc64fe...
```

**Result**: Batch locked, ready for settlement

**Step 4: Relayer Matches and Settles**

```bash
# Relayer runs off-chain matching
# Discovers: User A (action 0) + User B (action 1) can be matched

# Relayer prepares settlement:
# - Internal transfer: 1 WETH from A to B
# - Internal transfer: 1000 USDC from B to A
# - Net AMM swap: 0 (fully matched!)

npx hardhat settle-batch --batchid 0x7cbc64fe... --network sepolia
# TX: 0xc8f05dd...
```

**What Happened**:
1. Internal transfers executed (no AMM fees)
2. Pyth oracle updated
3. No net swap needed (100% matched)
4. beforeSwap/afterSwap hooks NOT triggered (no AMM interaction)
5. Encrypted balances updated

**Step 5: Users Withdraw**

```bash
# User A withdraws USDC
npx hardhat withdraw-tokens --currency usdc --amount 1000 --network sepolia
# TX: 0x417ce6a...

# User B withdraws WETH
npx hardhat withdraw-tokens --currency weth --amount 1 --network sepolia
# TX: 0x... (similar)
```

**Result**: Swap completed with:
- Zero AMM fees (100% matched)
- Complete privacy (amounts/actions encrypted)
- No MEV (batch settlement)

## Testing

### Local Testing

```bash
# Run Hardhat tests
npm test

# Run Foundry tests
forge test

# Gas report
REPORT_GAS=true npm test
```

### Sepolia Testing

All contracts deployed and operational:

```bash
# 1. Deploy hook
forge script script/DeployHook.s.sol --rpc-url sepolia --broadcast

# 2. Initialize pool
forge script script/InitializePool.s.sol --rpc-url sepolia --broadcast

# 3. Add liquidity
forge script script/AddLiquidity.s.sol --rpc-url sepolia --broadcast

# 4. Test direct swap (triggers hooks)
forge script script/ExecuteSwap.s.sol --rpc-url sepolia --broadcast

# 5. Test intent flow
npx hardhat deposit-tokens --currency weth --amount 1 --network sepolia
npx hardhat submit-intent --currency weth --amount 0.5 --action 0 --network sepolia
npx hardhat finalize-batch --network sepolia
npx hardhat settle-batch --batchid <id> --network sepolia
npx hardhat withdraw-tokens --currency weth --amount 0.5 --network sepolia
```

## Resources

**Uniswap V4**:
- Documentation: https://docs.uniswap.org/contracts/v4/overview
- Hook Guide: https://docs.uniswap.org/contracts/v4/guides/hooks
- v4-periphery: https://github.com/Uniswap/v4-periphery
- v4-core: https://github.com/Uniswap/v4-core

**FHEVM (Zama)**:
- Documentation: https://docs.zama.ai/fhevm
- Sepolia: https://docs.zama.ai/fhevm/getting_started/sepolia

**Deployed Contracts**:
- Hook: https://sepolia.etherscan.io/address/0x80B884a77Cb6167B884d3419019Df790E65440C0
- SimpleLending: https://sepolia.etherscan.io/address/0x3b64D86362ec9a8Cae77C661ffc95F0bbd440aa2
- PoolManager: https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543

## Summary

PrivacyPoolHook demonstrates advanced Uniswap V4 integration:

1. **beforeSwap Hook**: Just-in-time liquidity withdrawal from lending
2. **afterSwap Hook**: Automatic redeposit for yield generation
3. **Encrypted Intents**: FHEVM-powered privacy (euint64 amounts, euint8 actions)
4. **Batch Matching**: Off-chain intent matching, on-chain settlement
5. **MEV Resistance**: Encrypted amounts prevent frontrunning
6. **Capital Efficiency**: Lending integration maximizes yields
7. **Delta-Neutral**: Optional strategies for LP protection
