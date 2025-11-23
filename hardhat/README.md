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

| Contract | Address | Deployment TX |
|----------|---------|---------------|
| **PrivacyPoolHook** | `0x80B884a77Cb6167B884d3419019Df790E65440C0` | [0x8dc16ab6...](https://sepolia.etherscan.io/tx/0x8dc16ab6b5d8bc47e196b36852024452a837cc7507cc00d5211be1f7fc43722c) |
| **SettlementLib** | `0x75E19a6273beA6888c85B2BF43D57Ab89E7FCb6E` | - |
| **SimpleLending** | `0x3b64D86362ec9a8Cae77C661ffc95F0bbd440aa2` | - |
| **PoolManager (Uniswap V4)** | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | Official deployment |
| **Pyth Oracle** | `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21` | Official deployment |
| **WETH (Mock)** | `0x0003897f666B36bf31Aa48BEEA2A57B16e60448b` | Test token |
| **USDC (Mock)** | `0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0` | Test token |

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

## Complete Testing Flow (Sepolia)

All functionality has been tested end-to-end on Sepolia testnet:

### Deployment & Configuration

1. ✅ **Hook Deployment**
   - TX: [0x8dc16ab6...](https://sepolia.etherscan.io/tx/0x8dc16ab6b5d8bc47e196b36852024452a837cc7507cc00d5211be1f7fc43722c)
   - Hook: `0x80B884a77Cb6167B884d3419019Df790E65440C0`
   - Gas: 7,420,237

2. ✅ **SimpleLending Configuration**
   - TX: [0x6ad979d3...](https://sepolia.etherscan.io/tx/0x6ad979d375954258a94db6f74229a34844813f7429f3d95bad6a011a33e9e692)
   - Configured lending protocol for liquidity shuttle
   - Gas: 66,805

3. ✅ **Pool Initialization**
   - TX: [0x02ed7345...](https://sepolia.etherscan.io/tx/0x02ed73451c703cd28a97ad9ffc4592fc563ff3463622fbab3ad0af5f643ef9ba)
   - WETH/USDC pool at 1:1 price
   - Gas: 75,643

4. ✅ **Liquidity Addition**
   - TX: [0x8321ad5c...](https://sepolia.etherscan.io/tx/0x8321ad5c517d48da8999985391a9acdf380a9bb2f0c410db0daf55b67921a323)
   - Added 1000 ether of each token
   - Tick range: -6000 to 6000
   - Gas: 1,916,009

### Direct Swap with SimpleLending Integration

5. ✅ **Direct Swap (beforeSwap + afterSwap)**
   - TX: [0xfd91f899...](https://sepolia.etherscan.io/tx/0xfd91f899f1f77c9c2be9cb815a0a3067d1475f7c03346d81525a44ce32a2a89a)
   - **beforeSwap**: Withdrew 0.1 WETH from SimpleLending
   - **Swap**: Executed 0.1 WETH → USDC on Uniswap V4
   - **afterSwap**: Redeposited tokens to SimpleLending
   - Gas: 211,774

### Intent-Based Private Trading Flow

6. ✅ **Deposit Encrypted Tokens**
   - TX: [0xe5d4a918...](https://sepolia.etherscan.io/tx/0xe5d4a9188064cee1f9f54fc530f3874348b9c82215a710b2c9351ae2b513e59a)
   - Deposited 2 WETH, received encrypted ERC7984 tokens
   - Balance: euint64 (fully encrypted)

7. ✅ **Submit Encrypted Intent**
   - TX: [0x266538aa...](https://sepolia.etherscan.io/tx/0x266538aacbc8dedf67a9056981595277bd4edd9e5a957da97f5b449254b650ba)
   - Encrypted amount: euint64 (1 WETH hidden)
   - Encrypted action: euint8 (action 0 hidden)
   - Batch ID: `0xac73cc7f897b13b16068ac3c62a0214890335523f3a6b398a068f901f8c33d8a`

8. ✅ **Finalize Batch**
   - TX: [0xd34b6c7b...](https://sepolia.etherscan.io/tx/0xd34b6c7b3d8bd69c944bb8e1ac7605a444b1d468b24afd83060834bc8dc5702f)
   - Batch locked for settlement

9. ✅ **Settle with Pyth Price Update**
   - TX: [0x7c209b67...](https://sepolia.etherscan.io/tx/0x7c209b67cef2b5c2dff98895fe663fc83646e51b1fe5eb5e91992fb97a199c26)
   - Fetched ETH/USD from Pyth Hermes API
   - Updated Pyth oracle on-chain
   - Consumed price for settlement
   - Gas: 76,440

10. ✅ **Withdraw Tokens**
   - TX: [0xe081b9c1...](https://sepolia.etherscan.io/tx/0xe081b9c19037dbc7b39717ed4cc0212ff1a976264bd4f5d85e4459b1f9c5f878)
   - Withdrew 0.5 WETH
   - Burned encrypted tokens, received ERC20

## Detailed Integration Guides

For comprehensive documentation on specific integrations:

- **Pyth Network Integration**: See [PYTH_INTEGRATION.md](./PYTH_INTEGRATION.md)
  - Complete Pull → Update → Consume workflow
  - Delta-neutral strategies with SimpleLending
  - Privacy-preserving price oracle usage
  - Example transactions with full analysis

- **Uniswap V4 Hook Integration**: See [UNISWAP_V4_INTEGRATION.md](./UNISWAP_V4_INTEGRATION.md)
  - beforeSwap and afterSwap hook implementations
  - Liquidity shuttle pattern with SimpleLending
  - Encrypted intent submission and settlement
  - Complete user journey with encrypted tokens
  - MEV protection through batching

## Architecture

### Key Components

- **PrivacyPoolHook**: Main hook contract with beforeSwap/afterSwap hooks
- **SettlementLib**: External library for batch settlement logic (saves ~1,380 bytes)
- **PoolEncryptedToken**: ERC7984 encrypted token per (pool, currency)
- **IntentQueue**: Manages encrypted intents per batch
- **FHEVM Integration**: Uses Zama's FHEVM for encrypted computations

### Hook Flags

The hook address `0x80B884a77Cb6167B884d3419019Df790E65440C0` has flags `0xC0`:
- `beforeSwap`: Liquidity shuttle from SimpleLending
- `afterSwap`: Redeposit idle tokens to SimpleLending

### CREATE2 Deployment

The hook was deployed using CREATE2 with HookMiner to ensure valid address flags:
- Salt: `0x0000000000000000000000000000000000000000000000000000000000000091`
- Deployer: `0x4e59b44847b379578588920cA78FbF26c0B4956C` (CREATE2 Factory)
- Deployment TX: [0x8dc16ab6...](https://sepolia.etherscan.io/tx/0x8dc16ab6b5d8bc47e196b36852024452a837cc7507cc00d5211be1f7fc43722c)

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
