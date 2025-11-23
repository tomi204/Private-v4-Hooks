# Private-v4-Hooks

Privacy-preserving Uniswap V4 Hook with encrypted intent matching, FHE-based privacy, and delta-neutral strategies.

## Track-Specific Documentation

- [Uniswap V4 Integration](./hardhat/UNISWAP_V4_INTEGRATION.md) - Complete guide to our Uniswap V4 hook implementation
- [Pyth Integration](./hardhat/PYTH_INTEGRATION.md) - Oracle integration for delta-zero strategy

## Overview

PrivacyPoolHook is a Uniswap V4 hook that enables private swaps through encrypted intents and batch matching. It uses Zama's FHEVM (Fully Homomorphic Encryption) to provide complete transaction privacy while maintaining capital efficiency through intent matching.

### Key Features

- **Intent Matching**: Opposite intents matched internally without touching AMM
- **Full Privacy**: Both amounts (euint64) and actions (euint8) are encrypted
- **Capital Efficiency**: Majority of trades settle without touching AMM
- **MEV Resistance**: Encrypted amounts + actions + batch execution
- **ERC7984 Standard**: Full OpenZeppelin compliance for encrypted tokens
- **Delta-Zero Strategy**: Automated rebalancing using Pyth oracles
- **Simple Lending**: Collateralized lending protocol integration

## Architecture

### Core Components

1. **PrivacyPoolHook** - Main hook contract implementing:
   - Encrypted intent submission
   - Batch settlement with internal matching
   - Deposit/withdraw with encrypted pool tokens
   - Integration with Uniswap V4 pool manager

2. **PoolEncryptedToken** (ERC7984) - Privacy-preserving token standard:
   - Encrypted balances using Zama FHEVM
   - Confidential transfers
   - 1:1 backing with ERC20 reserves

3. **DeltaZeroStrategy** - Automated rebalancing:
   - Monitors pool price via Pyth oracle
   - Executes rebalancing when price deviates
   - Integrates with lending protocol

4. **SimpleLending** - Collateralized lending:
   - ETH borrowing against collateral
   - 6% annual interest rate
   - 90% collateral factor

### Privacy Model

- **Amounts**: `euint64` - Nobody can see trade size
- **Actions**: `euint8` - Nobody can see trade direction (0=swap0→1, 1=swap1→0)
- **Only relayer with FHE permissions** can decrypt for matching

### How It Works

1. Users deposit ERC20 → receive encrypted pool tokens (ERC7984)
2. Users submit encrypted intents (amount + action both encrypted)
3. Relayer matches opposite intents off-chain (with FHE permissions)
4. Settlement: internal transfers (matched) + net AMM swap (unmatched)
5. Users withdraw encrypted tokens → receive ERC20 back

## Requirements

- Node.js >= 20
- npm >= 7.0.0
- Hardhat 2.26.0

## Installation

```bash
cd hardhat
npm install
```

## Configuration

### Environment Variables

Set up your environment variables using Hardhat vars:

```bash
npx hardhat vars setup
```

Required variables:
- `MNEMONIC` - Your wallet mnemonic (defaults to test mnemonic)
- `INFURA_API_KEY` - For Sepolia deployment
- `ETHERSCAN_API_KEY` - For contract verification

### Networks

The project is configured for:
- **hardhat** (default) - Local development network
- **anvil** - Foundry local network (port 8545)
- **sepolia** - Ethereum testnet

## Development

### Compile Contracts

```bash
npm run compile
```

This will:
- Compile all Solidity contracts (0.8.27 & 0.8.26)
- Generate TypeChain types
- Use Cancun EVM version with IR compilation

### Run Tests

```bash
npm test
```

This runs the complete test suite:
- PrivacyPoolHook basic functionality
- Settlement mechanism
- Shuttle operations
- Delta-zero strategy with Pyth oracle
- SimpleLending protocol

For coverage:

```bash
npm run coverage
```

### Available Scripts

```bash
npm run clean         # Clean artifacts and regenerate types
npm run compile       # Compile contracts
npm run test          # Run all tests
npm run test:sepolia  # Run tests on Sepolia
npm run lint          # Lint Solidity and TypeScript
npm run prettier:write # Format code
npm run chain         # Start local Hardhat node
```

## Deployment

### Local Deployment

1. Start a local node:
```bash
npm run chain
```

2. Deploy contracts:
```bash
npm run deploy:localhost
```

### Sepolia Deployment

```bash
npm run deploy:sepolia
```

Verify contracts:
```bash
npm run verify:sepolia
```

## Project Structure

```
hardhat/
├── contracts/
│   ├── PrivacyPoolHook.sol          # Main hook implementation
│   ├── DeltaZeroStrategy.sol        # Rebalancing strategy
│   ├── SimpleLending.sol            # Lending protocol
│   ├── tokens/
│   │   ├── PoolEncryptedToken.sol   # ERC7984 implementation
│   │   └── ConfidentialToken.sol    # Base encrypted token
│   ├── libraries/
│   │   ├── IntentTypes.sol          # Intent data structures
│   │   └── SettlementLib.sol        # Settlement logic
│   ├── interfaces/
│   │   ├── IDeltaZeroStrategy.sol
│   │   └── ISimpleLending.sol
│   └── mocks/                       # Testing utilities
├── test/                            # Test files
├── scripts/                         # Deployment scripts
└── tasks/                           # Hardhat tasks
```

## Key Dependencies

- **@fhevm/solidity** (0.9.1) - Zama FHEVM for encryption
- **@uniswap/v4-core** (1.0.2) - Uniswap V4 protocol
- **@uniswap/v4-periphery** (1.0.3) - Uniswap V4 utilities
- **@pythnetwork/pyth-sdk-solidity** (4.2.0) - Price oracles
- **@openzeppelin/contracts** (5.4.0) - Standard contracts
- **openzeppelin-confidential-contracts** - Encrypted token standards

## Testing Strategy

The test suite is organized into modules:

1. **PrivacyPoolHook.ts** - Basic hook functionality
2. **PrivacyPoolHook.settlement.ts** - Intent settlement and matching
3. **PrivacyPoolHook.shuttle.ts** - Token deposit/withdraw flows
4. **PrivacyPoolHook.deltazero.ts** - Oracle integration and rebalancing

## Solidity Compiler Settings

- **Version**: 0.8.27 (primary), 0.8.26 (compatibility)
- **Optimizer**: Enabled with runs=1 (minimize bytecode)
- **EVM Version**: Cancun
- **Via IR**: Enabled (prevents stack too deep errors)

## Security Considerations

- ReentrancyGuard on all external functions
- Ownable2Step for safe ownership transfers
- SafeERC20 for token interactions
- FHE encryption for sensitive data
- Comprehensive test coverage

## License

BSD-3-Clause-Clear

## Contributing

Based on the [fhevm-hardhat-template](https://github.com/zama-ai/fhevm-hardhat-template) by Zama.
