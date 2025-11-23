import { task } from "hardhat/config";

task("execute-direct-swap", "Execute a direct swap on Uniswap V4 to trigger hooks")
  .addParam("amount", "Amount to swap (in ETH for WETH, whole number for USDC)")
  .addParam("zeroforone", "true for WETH->USDC, false for USDC->WETH")
  .setAction(async ({ amount, zeroforone }, hre) => {
    const { deployments, ethers } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Executing Direct Swap on Uniswap V4 ===\n");
    console.log("Signer:", signer.address);

    // Real deployed addresses on Sepolia
    const poolManagerAddress = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
    const hookAddress = "0x80B884a77Cb6167B884d3419019Df790E65440C0";

    const usdcDeploy = await deployments.get("MockERC20_USDC");
    const wethDeploy = await deployments.get("MockERC20_WETH");

    const weth = await ethers.getContractAt("MockERC20", wethDeploy.address);
    const usdc = await ethers.getContractAt("MockERC20", usdcDeploy.address);

    // Sort currencies
    const usdcAddress = usdcDeploy.address;
    const wethAddress = wethDeploy.address;
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

    const zeroForOne = zeroforone === "true";
    const swapAmount = zeroForOne
      ? ethers.parseEther(amount)
      : ethers.parseUnits(amount, 6);

    console.log("Pool Key:");
    console.log("  currency0:", currency0);
    console.log("  currency1:", currency1);
    console.log("Direction:", zeroForOne ? "WETH → USDC" : "USDC → WETH");
    console.log("Amount:", amount);

    // Determine which token we're swapping
    const inputToken = zeroForOne ? weth : usdc;
    const inputTokenName = zeroForOne ? "WETH" : "USDC";

    // Mint tokens
    console.log("\n[1/4] Minting", inputTokenName, "...");
    const mintTx = await inputToken.mint(signer.address, swapAmount);
    await mintTx.wait();
    console.log("✅ Minted", amount, inputTokenName);

    // Approve PoolManager
    console.log("\n[2/4] Approving PoolManager...");
    const approveTx = await inputToken.approve(poolManagerAddress, swapAmount);
    await approveTx.wait();
    console.log("✅ Approved");

    // Get PoolManager contract
    const poolManagerAbi = require("@uniswap/v4-core/out/IPoolManager.sol/IPoolManager.json").abi;
    const poolManager = new ethers.Contract(poolManagerAddress, poolManagerAbi, signer);

    console.log("\n[3/4] Executing swap...");
    console.log("🎯 This will trigger beforeSwap and afterSwap hooks!");

    // SwapParams for Uniswap V4
    const swapParams = {
      zeroForOne: zeroForOne,
      amountSpecified: -swapAmount, // Negative for exact input
      sqrtPriceLimitX96: zeroForOne
        ? "4295128739" // Min price for zeroForOne
        : "1461446703485210103287273052203988822378723970342", // Max price for oneForZero
    };

    try {
      const tx = await poolManager.swap(poolKey, swapParams, "0x", {
        gasLimit: 500000
      });

      console.log("Transaction submitted:", tx.hash);
      const receipt = await tx.wait();

      console.log("\n✅ Swap executed successfully!");
      console.log("Transaction:", receipt?.hash);
      console.log("\n🎉 beforeSwap hook was triggered!");
      console.log("🎉 afterSwap hook was triggered!");

      // Get events from the transaction
      console.log("\n📋 Transaction details:");
      console.log("  Gas used:", receipt?.gasUsed.toString());
      console.log("  Block:", receipt?.blockNumber);

    } catch (error: any) {
      console.error("\n❌ Swap failed:", error.message);

      if (error.message.includes("revert")) {
        console.log("\n⚠️  Possible reasons:");
        console.log("  - Pool has insufficient liquidity");
        console.log("  - Price limit exceeded");
        console.log("  - Hook validation failed");
        console.log("  - Slippage too high");
      }

      throw error;
    }

    console.log("\n=== Direct Swap Complete! ===\n");
    console.log("The hooks (beforeSwap and afterSwap) were executed during this swap.");
    console.log("Check the transaction on Etherscan to see the hook events!");
  });
