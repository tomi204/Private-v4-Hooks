import { task } from "hardhat/config";

task("initialize-pool", "Initialize the Uniswap V4 pool with deployed hook")
  .setAction(async (_, hre) => {
    const { deployments, ethers } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Initializing Uniswap V4 Pool ===\n");

    // Real addresses on Sepolia
    const poolManagerAddress = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543"; // Real Uniswap V4
    const hookAddress = "0x80B884a77Cb6167B884d3419019Df790E65440C0"; // Our deployed hook

    // Get deployed mock tokens
    const usdcDeploy = await deployments.get("MockERC20_USDC");
    const wethDeploy = await deployments.get("MockERC20_WETH");

    console.log("Signer:", signer.address);
    console.log("PoolManager (Real Uniswap V4):", poolManagerAddress);
    console.log("Hook:", hookAddress);

    // Sort currencies (Uniswap V4 requirement)
    const usdcAddress = usdcDeploy.address;
    const wethAddress = wethDeploy.address;
    const [currency0, currency1] =
      usdcAddress.toLowerCase() < wethAddress.toLowerCase()
        ? [usdcAddress, wethAddress]
        : [wethAddress, usdcAddress];

    const poolKey = {
      currency0,
      currency1,
      fee: 3000, // 0.3%
      tickSpacing: 60,
      hooks: hookAddress,
    };

    console.log("\nPoolKey:");
    console.log(`  currency0: ${poolKey.currency0}`);
    console.log(`  currency1: ${poolKey.currency1}`);
    console.log(`  fee: 0.3%`);
    console.log(`  tickSpacing: ${poolKey.tickSpacing}`);
    console.log(`  hooks: ${poolKey.hooks}`);

    // Initialize at 1:1 price
    const sqrtPriceX96 = BigInt("79228162514264337593543950336");
    console.log("\nInitializing pool at 1:1 price...");

    const poolManagerAbi = require("@uniswap/v4-core/out/IPoolManager.sol/IPoolManager.json").abi;
    const poolManager = new ethers.Contract(poolManagerAddress, poolManagerAbi, signer);

    try {
      const tx = await poolManager.initialize(poolKey, sqrtPriceX96, "0x");
      console.log("Transaction hash:", tx.hash);
      await tx.wait();
      console.log("✅ Pool initialized successfully!");
    } catch (error: any) {
      if (error.message.includes("PoolAlreadyInitialized") || error.message.includes("already initialized")) {
        console.log("✅ Pool already initialized");
      } else {
        console.error("Error:", error.message);
        throw error;
      }
    }

    console.log("\n=== Pool Initialization Complete ===\n");
  });
