# PrivacyPoolHook - Uniswap V4 Hook with FHEVM

A production-ready Uniswap V4 hook deployed on Ethereum Sepolia that enables private swaps through encrypted intents and batch matching using FHEVM (Fully Homomorphic Encryption).

## Overview

PrivacyPoolHook provides:

- **Full Privacy**: Both swap amounts (euint64) and actions (euint8) are encrypted
- **Intent-Based Swaps**: Users submit encrypted intents instead of executing swaps directly
- **Batch Settlement**: Relayers match and execute intents in batches
- **MEV Resistance**: Encrypted amounts + actions + batch execution prevent frontrunning
- **ERC7984 Encrypted Tokens**: Each pool/currency gets encrypted token representation

## Deployed Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| **PrivacyPoolHook** | `0x25E02663637E83E22F8bBFd556634d42227400C0` |
| **SettlementLib** | `0x75E19a6273beA6888c85B2BF43D57Ab89E7FCb6E` |
| **PoolManager (Uniswap V4)** | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| **Pyth Oracle** | `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21` |
| **WETH (Mock)** | `0x0003897f666B36bf31Aa48BEEA2A57B16e60448b` |
| **USDC (Mock)** | `0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0` |

## How It Works

1. **Deposit**: Users deposit ERC20 → receive encrypted pool tokens (ERC7984)
2. **Intent**: Users submit encrypted intents (amount + action both encrypted)
3. **Batch**: Relayers match intents using encrypted computations
4. **Settle**: Execute matched swaps on Uniswap V4, update encrypted balances
5. **Withdraw**: Users burn encrypted tokens → receive ERC20 back

## Quick Start

### Prerequisites

- **Node.js**: Version 20 or higher
- **Foundry**: For deployment scripts
- **npm**: Package manager

### Installation

```bash
# Install dependencies
npm install
forge install

# Set environment variables
npx hardhat vars set MNEMONIC "your twelve word mnemonic..."
npx hardhat vars set INFURA_API_KEY "your-infura-key"
npx hardhat vars set ETHERSCAN_API_KEY "your-etherscan-key"
```

### Usage (Contracts Already Deployed on Sepolia)

#### 1. Deposit Tokens

```bash
# Deposit 1 WETH
npx hardhat deposit-tokens --currency weth --amount 1 --network sepolia

# Deposit 1000 USDC
npx hardhat deposit-tokens --currency usdc --amount 1000 --network sepolia
```

#### 2. Submit Encrypted Intent

```bash
# Swap 0.5 WETH for USDC (action 0)
npx hardhat submit-intent --currency weth --amount 0.5 --action 0 --network sepolia
```

Actions:
- `0` = SWAP_0_TO_1 (WETH → USDC)
- `1` = SWAP_1_TO_0 (USDC → WETH)

#### 3. Finalize Batch

```bash
# Finalize the current batch
npx hardhat finalize-batch --network sepolia
```

#### 4. Settle Batch (Triggers Pyth Oracle + Hooks)

```bash
# Settle finalized batch (only relayer)
npx hardhat settle-batch --batchid <batch-id> --network sepolia
```

**What happens:**
- Fetches latest ETH/USD price from Pyth Hermes API
- Updates Pyth oracle on-chain
- Executes net swap on Uniswap V4
- **Triggers beforeSwap and afterSwap hooks**

#### 5. Withdraw Tokens

```bash
# Withdraw 0.2 WETH
npx hardhat withdraw-tokens --currency weth --amount 0.2 --network sepolia
```

## Testing Results ✅

All functionality has been tested on Sepolia:

1. ✅ **Deposit**: Successfully deposited 2 WETH and 2000 USDC
   - TX: [0xc03c0cd...](https://sepolia.etherscan.io/tx/0xc03c0cd272cd38c0b719c7f97e3849377e3de14d2c99c3e5d69cc38b29a9dd2c)
   - TX: [0x353a2f4...](https://sepolia.etherscan.io/tx/0x353a2f4ab23c1eb8de7d79769c6a681051e5317cbe056a777082fddf900cbcf6)

2. ✅ **Submit Intent**: Successfully submitted encrypted swap intent
   - TX: [0xb1d8052...](https://sepolia.etherscan.io/tx/0xb1d8052a56fadaabe44c588079cb30448c0622af67e18577a21e5fee8a8ac17a)

3. ✅ **Finalize Batch**: Successfully finalized batch for settlement
   - TX: [0x9e58815...](https://sepolia.etherscan.io/tx/0x9e588158ded180405cc99eb049dba9cc9b1310865e735aad5e58c4dcbc2e73f1)

4. ✅ **Settle Batch with Pyth**: Successfully settled with oracle update + hooks execution
   - TX: [0xc8f05dd...](https://sepolia.etherscan.io/tx/0xc8f05dd27657b588e3589fa0e167fc574f690d27087eb507cbea4c2504740ad3)
   - ✅ Pyth oracle updated on-chain
   - ✅ Pyth price consumed (event emitted)
   - ✅ beforeSwap and afterSwap hooks executed

5. ✅ **Withdraw**: Successfully withdrawn 0.5 WETH
   - TX: [0x417ce6a...](https://sepolia.etherscan.io/tx/0x417ce6a87d55dd90eccd75153d2f1dc432084eba274bbcaba006da8055d224a9)

## Architecture

### Key Components

- **PrivacyPoolHook**: Main hook contract with beforeSwap/afterSwap hooks
- **SettlementLib**: External library for batch settlement logic (saves ~1,380 bytes)
- **PoolEncryptedToken**: ERC7984 encrypted token per (pool, currency)
- **IntentQueue**: Manages encrypted intents per batch
- **FHEVM Integration**: Uses Zama's FHEVM for encrypted computations

### Hook Flags

The hook address `0x25E02663637E83E22F8bBFd556634d42227400C0` has flags `0xC0`:
- `beforeSwap`: Validate swaps against intents
- `afterSwap`: Update encrypted balances post-swap

### CREATE2 Deployment

The hook was deployed using CREATE2 with HookMiner to ensure valid address flags:
- Salt: `0x00000000000000000000000000000000000000000000000000000000000048f4`
- Deployer: `0x026ba0AA63686278C3b3b3b9C43bEdD8421E36Cd`

## Development

### Build

```bash
# Hardhat
npm run compile

# Foundry
forge build
```

### Test

```bash
# Hardhat tests
npm test

# Foundry tests
forge test

# Gas report
REPORT_GAS=true npm test
```

### Contract Size Optimizations

The contract uses several optimizations to stay under 24KB:
- External library (SettlementLib) saves ~1,380 bytes
- Optimizer runs = 1 (minimize bytecode size)
- Via IR compilation enabled
- Custom error codes instead of strings

## Pool Configuration

- **Currency0**: WETH (`0x0003897f666B36bf31Aa48BEEA2A57B16e60448b`)
- **Currency1**: USDC (`0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0`)
- **Fee**: 0.3% (3000)
- **Tick Spacing**: 60
- **Initial Price**: 1:1

## Links

- **Hook on Etherscan**: https://sepolia.etherscan.io/address/0x25E02663637E83E22F8bBFd556634d42227400C0
- **Uniswap V4 Docs**: https://docs.uniswap.org/contracts/v4/overview
- **FHEVM Docs**: https://docs.zama.ai/fhevm

## License

MIT
