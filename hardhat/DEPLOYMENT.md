# Deployment Scripts

This directory contains deployment scripts for the PrivacyPoolHook system.

## Scripts Overview

The deployment is organized in 5 stages:

### 00_deploy_dependencies.ts
Deploys base dependencies:
- **MockERC20_USDC**: Mock USDC token (6 decimals)
- **MockERC20_WETH**: Mock WETH token (18 decimals)
- **MockPyth**: Mock Pyth oracle for price feeds
- **SimpleLending**: Lending protocol for liquidity shuttle

### 01_deploy_uniswap.ts
Deploys Uniswap V4 infrastructure:
- **PoolManager**: Uniswap V4 pool manager

### 02_deploy_libraries.ts
Deploys libraries:
- **SettlementLib**: Settlement logic library (reduces main contract size)

### 03_deploy_privacy_pool_hook.ts
Deploys the main hook contract:
- **PrivacyPoolHook**: Main privacy-preserving swap hook with FHEVM
  - Linked to SettlementLib
  - Configured with PoolManager, relayer, and Pyth oracle
  - Funded with 10 ETH for operations

### 04_initialize_pool.ts
Initializes and configures the system:
- Creates USDC/WETH pool with 0.3% fee
- Initializes pool with 1:1 price
- Configures SimpleLending in hook
- Initializes Pyth price feed (ETH/USD = $2000)
- Funds SimpleLending with initial liquidity:
  - 100,000 USDC
  - 50 WETH
- Prints deployment summary

## Usage

### Quick Deploy (Hardhat Network)

Deploy to in-memory hardhat network for testing:
```bash
npx hardhat deploy --network hardhat
```

### Deploy to localhost

1. Start local node:
```bash
npm run chain
```

2. In another terminal, deploy:
```bash
npm run deploy:localhost
```

### Deploy to Sepolia testnet

```bash
npm run deploy:sepolia
```

## Deployed Contracts (Example - Hardhat Network)

After successful deployment, you'll see:

```
Core Contracts:
  PoolManager: 0xC0b363C61775259d42464E449DC0F6a1b55E6cF0
  PrivacyPoolHook: 0x33954A21deBd069735b18D496f7A446B56457477
  SettlementLib: 0x7D0Fb33E2f5cC55c72018b8720fEdcb8a985A0Fd

Tokens:
  USDC: 0xfd6522C7dA0A3DD3AE351c4849cF34feF0afB51c
  WETH: 0xF64DcC5b42fABd11062095Ed0faF68a7A273bD26

Oracles & DeFi:
  MockPyth: 0xfa429d17e59505a754dE29E51a83adF5bc010f4e
  SimpleLending: 0xB11dF1d1EDC722153E53A2B677A80A4FB3C72d7d

Pool Configuration:
  Currency0: 0xF64DcC5b42fABd11062095Ed0faF68a7A273bD26 (WETH)
  Currency1: 0xfd6522C7dA0A3DD3AE351c4849cF34feF0afB51c (USDC)
  Fee: 0.3%
  Initial Price: 1:1
```

## Deployment Order

Scripts run in numerical order (00, 01, 02, 03, 04) automatically via hardhat-deploy.

Dependencies are enforced via `func.dependencies` to ensure correct deployment order.

## Tags

You can deploy specific components using tags:

```bash
# Deploy only dependencies
npx hardhat deploy --tags dependencies

# Deploy only libraries
npx hardhat deploy --tags libraries

# Deploy only hook
npx hardhat deploy --tags hook

# Deploy everything
npx hardhat deploy
```

## Contract Size

PrivacyPoolHook uses external library (SettlementLib) to stay under the 24KB contract size limit:
- **Current size**: 23,641 bytes
- **Limit**: 24,576 bytes
- **Remaining**: 935 bytes (3.8%)

## Notes

- Relayer address defaults to deployer in test/demo
- For production, use a dedicated relayer address
- SimpleLending is funded with initial liquidity for testing
- Pyth price feed is initialized with ETH/USD = $2000
