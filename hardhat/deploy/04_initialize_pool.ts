import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { get } = hre.deployments;

  console.log("\n=== Initializing Pool ===\n");

  // Get deployed contracts
  const poolManagerDeployment = await get("PoolManager");
  const privacyPoolHookDeployment = await get("PrivacyPoolHook");
  const usdcDeployment = await get("MockERC20_USDC");
  const wethDeployment = await get("MockERC20_WETH");
  const simpleLendingDeployment = await get("SimpleLending");

  // Use real Pyth on Sepolia, mock for local
  let pythAddress: string;
  if (hre.network.name === "sepolia") {
    pythAddress = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21"; // Real Pyth on Sepolia
  } else {
    const mockPythDeployment = await get("MockPyth");
    pythAddress = mockPythDeployment.address;
  }

  const poolManager = await ethers.getContractAt("PoolManager", poolManagerDeployment.address);
  const hook = await ethers.getContractAt("PrivacyPoolHook", privacyPoolHookDeployment.address);
  const usdc = await ethers.getContractAt("MockERC20", usdcDeployment.address);
  const weth = await ethers.getContractAt("MockERC20", wethDeployment.address);
  const simpleLending = await ethers.getContractAt("SimpleLending", simpleLendingDeployment.address);

  // Sort currencies (Uniswap V4 requirement)
  const usdcAddress = await usdc.getAddress();
  const wethAddress = await weth.getAddress();
  const [currency0, currency1] =
    usdcAddress.toLowerCase() < wethAddress.toLowerCase()
      ? [usdcAddress, wethAddress]
      : [wethAddress, usdcAddress];

  // Create PoolKey
  const poolKey = {
    currency0,
    currency1,
    fee: 3000, // 0.3%
    tickSpacing: 60,
    hooks: await hook.getAddress(),
  };

  console.log("PoolKey:");
  console.log(`  currency0: ${poolKey.currency0}`);
  console.log(`  currency1: ${poolKey.currency1}`);
  console.log(`  fee: ${poolKey.fee}`);
  console.log(`  tickSpacing: ${poolKey.tickSpacing}`);
  console.log(`  hooks: ${poolKey.hooks}`);

  // Initialize pool with 1:1 price
  const sqrtPriceX96 = BigInt("79228162514264337593543950336"); // 1:1 price
  console.log("\nInitializing pool with 1:1 price...");

  try {
    const initTx = await poolManager.initialize(poolKey, sqrtPriceX96);
    await initTx.wait();
    console.log("Pool initialized successfully");
  } catch (error: any) {
    if (error.message.includes("PoolAlreadyInitialized")) {
      console.log("Pool already initialized, skipping...");
    } else {
      throw error;
    }
  }

  // Set SimpleLending in hook
  console.log("\nConfiguring SimpleLending in hook...");
  const setLendingTx = await hook.setSimpleLending(await simpleLending.getAddress());
  await setLendingTx.wait();
  console.log("SimpleLending configured");

  // Initialize Pyth price feed (only for local mock)
  if (hre.network.name !== "sepolia") {
    const mockPyth = await ethers.getContractAt("contracts/mocks/MockPyth.sol:MockPyth", pythAddress);
    const ETH_USD_PRICE_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
    console.log("\nInitializing Pyth price feed...");

    const initialPriceUpdate = await mockPyth.createPriceFeedUpdateData(
      ETH_USD_PRICE_FEED,
      2000n * 100000n, // $2000
      10n * 100000n,
      -5,
      2000n * 100000n,
      10n * 100000n,
      BigInt(Math.floor(Date.now() / 1000)),
      BigInt(Math.floor(Date.now() / 1000))
    );

    const updateFee = await mockPyth.getUpdateFee([initialPriceUpdate]);
    const pythUpdateTx = await mockPyth.updatePriceFeeds([initialPriceUpdate], { value: updateFee });
    await pythUpdateTx.wait();
    console.log("Pyth price feed initialized with ETH/USD = $2000");
  } else {
    console.log("\nUsing real Pyth oracle on Sepolia - no initialization needed");
  }

  // Skip SimpleLending funding on public testnets (FHEVM not available)
  if (hre.network.name !== "sepolia") {
    console.log("\nFunding SimpleLending with liquidity...");
    const signer = await ethers.getSigner(deployer);

    // Mint and supply USDC
    const usdcAmount = ethers.parseUnits("100000", 6);
    await usdc.mint(deployer, usdcAmount);
    await usdc.approve(await simpleLending.getAddress(), usdcAmount);
    await simpleLending.supply(usdc, usdcAmount);
    console.log(`Supplied ${ethers.formatUnits(usdcAmount, 6)} USDC to SimpleLending`);

    // Mint and supply WETH
    const wethAmount = ethers.parseEther("50");
    await weth.mint(deployer, wethAmount);
    await weth.approve(await simpleLending.getAddress(), wethAmount);
    await simpleLending.supply(weth, wethAmount);
    console.log(`Supplied ${ethers.formatEther(wethAmount)} WETH to SimpleLending`);
  } else {
    console.log("\nSkipping SimpleLending funding on Sepolia");
    console.log("Use the 'deposit-tokens' task to interact with the hook");
  }

  console.log("\n=== Pool Initialized ===\n");

  // Print deployment summary
  console.log("=== DEPLOYMENT SUMMARY ===\n");
  console.log("Core Contracts:");
  console.log(`  PoolManager: ${poolManagerDeployment.address}`);
  console.log(`  PrivacyPoolHook: ${privacyPoolHookDeployment.address}`);
  console.log(`  SettlementLib: ${(await get("SettlementLib")).address}`);
  console.log("\nTokens:");
  console.log(`  USDC: ${usdcDeployment.address}`);
  console.log(`  WETH: ${wethDeployment.address}`);
  console.log("\nOracles & DeFi:");
  console.log(`  Pyth: ${pythAddress}`);
  console.log(`  SimpleLending: ${simpleLendingDeployment.address}`);
  console.log("\nPool Configuration:");
  console.log(`  Currency0: ${poolKey.currency0}`);
  console.log(`  Currency1: ${poolKey.currency1}`);
  console.log(`  Fee: 0.3%`);
  console.log(`  Initial Price: 1:1`);
  console.log("\n=== DEPLOYMENT COMPLETE ===\n");
};

export default func;
func.id = "initialize_pool";
func.tags = ["initialize"];
func.dependencies = ["hook"];
