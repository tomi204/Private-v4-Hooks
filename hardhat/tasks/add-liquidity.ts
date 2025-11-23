import { task } from "hardhat/config";

task("add-liquidity", "Add liquidity to Uniswap V4 pool")
  .addParam("amount0", "Amount of currency0 (WETH)")
  .addParam("amount1", "Amount of currency1 (USDC)")
  .setAction(async ({ amount0, amount1 }, hre) => {
    const { ethers } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Adding Liquidity to Uniswap V4 Pool ===\n");
    console.log("Signer:", signer.address);

    // Real deployed addresses on Sepolia
    const poolManagerAddress = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
    const hookAddress = "0x80B884a77Cb6167B884d3419019Df790E65440C0";
    const wethAddress = "0x0003897f666B36bf31Aa48BEEA2A57B16e60448b";
    const usdcAddress = "0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0";

    const weth = await ethers.getContractAt("MockERC20", wethAddress);
    const usdc = await ethers.getContractAt("MockERC20", usdcAddress);

    // Sort currencies
    const [currency0, currency1] =
      usdcAddress.toLowerCase() < wethAddress.toLowerCase()
        ? [usdcAddress, wethAddress]
        : [wethAddress, usdcAddress];

    const poolKey = {
      currency0,
      currency1,
      fee: 3000,
      tickSpacing: 60,
      hooks: hookAddress,
    };

    // Parse amounts (WETH = currency0 in this case)
    const amount0Parsed = ethers.parseUnits(amount0, 18); // WETH
    const amount1Parsed = ethers.parseUnits(amount1, 6);  // USDC

    console.log("Amount0 (WETH):", amount0Parsed.toString());
    console.log("Amount1 (USDC):", amount1Parsed.toString());

    // Mint tokens
    console.log("\n[1/4] Minting tokens...");
    const mintTx0 = await weth.mint(signer.address, amount0Parsed);
    await mintTx0.wait();
    const mintTx1 = await usdc.mint(signer.address, amount1Parsed);
    await mintTx1.wait();
    console.log("✅ Minted tokens");

    // Approve PoolManager
    console.log("\n[2/4] Approving PoolManager...");
    const approveTx0 = await weth.approve(poolManagerAddress, amount0Parsed);
    await approveTx0.wait();
    const approveTx1 = await usdc.approve(poolManagerAddress, amount1Parsed);
    await approveTx1.wait();
    console.log("✅ Approved");

    // Get PoolManager contract
    const poolManagerAbi = require("@uniswap/v4-core/out/IPoolManager.sol/IPoolManager.json").abi;
    const poolManager = new ethers.Contract(poolManagerAddress, poolManagerAbi, signer);

    // Add liquidity using modifyLiquidity
    console.log("\n[3/4] Adding liquidity...");

    // ModifyLiquidityParams
    const modifyParams = {
      tickLower: -60, // One tick below current
      tickUpper: 60,  // One tick above current
      liquidityDelta: ethers.parseEther("1"), // Amount of liquidity
      salt: "0x0000000000000000000000000000000000000000000000000000000000000000"
    };

    try {
      const tx = await poolManager.modifyLiquidity(poolKey, modifyParams, "0x");
      const receipt = await tx.wait();
      console.log("✅ Liquidity added!");
      console.log("Transaction:", receipt?.hash);
    } catch (error: any) {
      console.error("Error adding liquidity:", error.message);
      throw error;
    }

    console.log("\n=== Liquidity Added Successfully! ===\n");
  });
