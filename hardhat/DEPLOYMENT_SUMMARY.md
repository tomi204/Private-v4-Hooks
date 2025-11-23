# PrivacyPoolHook - Deployment Summary

## Deployed Contracts on Sepolia

### Core Contracts

| Contract | Address | Notes |
|----------|---------|-------|
| **PrivacyPoolHook** | `0x25E02663637E83E22F8bBFd556634d42227400C0` | Deployed with CREATE2, valid flags 0xC0 |
| **Deploy TX** | [0xe516bd7...](https://sepolia.etherscan.io/tx/0xe516bd726b8f2dbe5125c2313a30d33f2e230f38584fe2328a699fce6f13ff82) | Hook deployment transaction |
| **SettlementLib** | `0x75E19a6273beA6888c85B2BF43D57Ab89E7FCb6E` | Library for settlement logic |
| **PoolManager (Uniswap V4)** | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | Real Uniswap V4 PoolManager |
| **Pyth Oracle** | `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21` | Real Pyth price oracle on Sepolia |

### Mock Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| **WETH** | `0x0003897f666B36bf31Aa48BEEA2A57B16e60448b` | 18 |
| **USDC** | `0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0` | 6 |

### Supporting Contracts

| Contract | Address |
|----------|---------|
| **SimpleLending** | `0x3b64D86362ec9a8Cae77C661ffc95F0bbd440aa2` |

## Pool Configuration

- **Currency0**: WETH (`0x0003897f666B36bf31Aa48BEEA2A57B16e60448b`)
- **Currency1**: USDC (`0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0`)
- **Fee**: 0.3% (3000)
- **Tick Spacing**: 60
- **Initial Price**: 1:1
- **Hook**: `0xeb66B316c2B212E07FdA8BC6A77477Ac1d6940c0`

## Hook Details

### CREATE2 Deployment
- **Salt**: `0x00000000000000000000000000000000000000000000000000000000000048f4`
- **Flags**: `0x40c0` (beforeSwap + afterSwap)
- **Deployer**: `0x026ba0AA63686278C3b3b3b9C43bEdD8421E36Cd`

### Verified Features
- ✅ Valid hook address with correct flags
- ✅ Deployed with CREATE2 using HookMiner
- ✅ Pool initialized on Uniswap V4
- ✅ Hook funded with 0.01 ETH

## Complete Workflow - TESTED ✅

All interactions have been successfully tested on Sepolia:

### 1. Deploy Contracts (Foundry)

```bash
# Set environment variables
export RELAYER=0x026ba0AA63686278C3b3b3b9C43bEdD8421E36Cd
export SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
export MNEMONIC="your twelve word mnemonic here"

# Deploy hook with CREATE2
forge script script/DeployHook.s.sol \
  --rpc-url sepolia \
  --mnemonics "$MNEMONIC" \
  --mnemonic-indexes 0 \
  --sender 0x026ba0AA63686278C3b3b3b9C43bEdD8421E36Cd \
  --broadcast \
  --legacy

# Initialize pool on Uniswap V4
forge script script/InitializePool.s.sol \
  --rpc-url sepolia \
  --mnemonics "$MNEMONIC" \
  --mnemonic-indexes 0 \
  --sender 0x026ba0AA63686278C3b3b3b9C43bEdD8421E36Cd \
  --broadcast \
  --legacy
```

### 2. Deposit Tokens (Hardhat)

Deposit ERC20 tokens to receive encrypted tokens:

```bash
# Deposit 1 WETH
npx hardhat deposit-tokens --currency weth --amount 1 --network sepolia

# Deposit 1000 USDC
npx hardhat deposit-tokens --currency usdc --amount 1000 --network sepolia
```

**What happens:**
- Mints tokens to your address
- Approves hook to spend tokens
- Deposits to hook → receives encrypted pool tokens (ERC7984)
- **Privacy**: Hook stores encrypted balances using FHEVM

✅ **Tested**: Successfully deposited 2 WETH and 2000 USDC
- TX: [0xc03c0cd...](https://sepolia.etherscan.io/tx/0xc03c0cd272cd38c0b719c7f97e3849377e3de14d2c99c3e5d69cc38b29a9dd2c)
- TX: [0x353a2f4...](https://sepolia.etherscan.io/tx/0x353a2f4ab23c1eb8de7d79769c6a681051e5317cbe056a777082fddf900cbcf6)

### 3. Submit Encrypted Swap Intent (Hardhat)

Submit encrypted swap intent with FHEVM:

```bash
# Swap 0.5 WETH for USDC (action 0 = SWAP_0_TO_1)
npx hardhat submit-intent --currency weth --amount 0.5 --action 0 --network sepolia
```

**What happens:**
- Initializes FHEVM for encryption
- Creates encrypted amount (euint64) using FHEVM
- Creates encrypted action (euint8) using FHEVM
- Sets hook as operator for encrypted tokens
- Submits intent to hook with encrypted data
- **Privacy**: Amount AND action are fully encrypted

✅ **Tested**: Successfully submitted encrypted intent for 1 WETH
- TX: [0xb1d8052...](https://sepolia.etherscan.io/tx/0xb1d8052a56fadaabe44c588079cb30448c0622af67e18577a21e5fee8a8ac17a)
- Batch ID: `0x7cbc64fe1f1a94a56c094506d75c16db8991768a6097d3ee45bc2fc6f0298278`

### 4. Withdraw Tokens (Hardhat)

Withdraw encrypted tokens back to ERC20:

```bash
# Withdraw 0.2 WETH
npx hardhat withdraw-tokens --currency weth --amount 0.2 --network sepolia
```

**What happens:**
- Burns encrypted tokens from your balance
- Returns ERC20 tokens to your wallet
- Hook converts encrypted amount to plain uint256

✅ **Tested**: Successfully withdrawn 0.5 WETH
- TX: [0x417ce6a...](https://sepolia.etherscan.io/tx/0x417ce6a87d55dd90eccd75153d2f1dc432084eba274bbcaba006da8055d224a9)

### 5. Finalize Batch (Anyone can call)

```bash
# Finalize the current batch
npx hardhat finalize-batch --network sepolia
```

**What happens:**
- Marks the current batch as finalized
- Batch is ready for relayer settlement
- Returns batch ID for next step

✅ **Tested**: Successfully finalized batch
- TX: [0x9e58815...](https://sepolia.etherscan.io/tx/0x9e588158ded180405cc99eb049dba9cc9b1310865e735aad5e58c4dcbc2e73f1)
- Batch ID: `0x7cbc64fe1f1a94a56c094506d75c16db8991768a6097d3ee45bc2fc6f0298278`

### 6. Settle Batch with Pyth Oracle Update (Relayer only) 🎯

```bash
# Settle finalized batch (triggers Pyth update + hooks)
npx hardhat settle-batch --batchid <batch-id> --network sepolia
```

**What happens:**
- **Fetches latest price from Pyth Hermes API** 🎯
- **Updates Pyth oracle on-chain** 🎯
- Executes internal transfers (matched intents)
- Executes net swap on Uniswap V4
- **Triggers beforeSwap hook** 🎯
- **Triggers afterSwap hook** 🎯
- Updates encrypted balances

✅ **Tested**: Successfully settled batch with Pyth update
- TX: [0xc8f05dd...](https://sepolia.etherscan.io/tx/0xc8f05dd27657b588e3589fa0e167fc574f690d27087eb507cbea4c2504740ad3)
- ✅ Pyth oracle updated on-chain
- ✅ Pyth price consumed in contract (event emitted)
- ✅ beforeSwap and afterSwap hooks executed

## Scripts & Tasks

### Deployment Scripts (Foundry)
- `script/DeployHook.s.sol` - Deploy hook with CREATE2
- `script/InitializePool.s.sol` - Initialize Uniswap V4 pool

### Interaction Tasks (Hardhat + FHEVM)
- `npx hardhat deposit-tokens --currency <weth|usdc> --amount <amount> --network sepolia`
- `npx hardhat submit-intent --currency <weth|usdc> --amount <amount> --action <0|1> --network sepolia`
- `npx hardhat finalize-batch --network sepolia`
- `npx hardhat settle-batch --batchid <batch-id> --network sepolia` (Triggers Pyth update + hooks)
- `npx hardhat withdraw-tokens --currency <weth|usdc> --amount <amount> --network sepolia`

## Links

- **Sepolia Etherscan**: https://sepolia.etherscan.io/address/0xeb66B316c2B212E07FdA8BC6A77477Ac1d6940c0
- **Uniswap V4 Docs**: https://docs.uniswap.org/contracts/v4/overview
