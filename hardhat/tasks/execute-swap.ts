import { task } from "hardhat/config";

task("execute-swap", "Execute a swap on Uniswap V4 to trigger beforeSwap/afterSwap hooks")
  .addParam("currency", "Input currency (weth or usdc)")
  .addParam("amount", "Amount to swap")
  .addParam("zeroforone", "true for WETH->USDC, false for USDC->WETH")
  .setAction(async ({ currency, amount, zeroforone }, hre) => {
    const { deployments, ethers } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Executing Swap on Uniswap V4 ===\n");
    console.log("Signer:", signer.address);

    // Real deployed addresses on Sepolia
    const poolManagerAddress = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
    const hookAddress = "0x80B884a77Cb6167B884d3419019Df790E65440C0";

    const usdcDeploy = await deployments.get("MockERC20_USDC");
    const wethDeploy = await deployments.get("MockERC20_WETH");

    // Determine token and decimals
    let tokenAddress: string;
    let tokenDecimals: number;
    if (currency.toLowerCase() === "usdc") {
      tokenAddress = usdcDeploy.address;
      tokenDecimals = 6;
    } else if (currency.toLowerCase() === "weth") {
      tokenAddress = wethDeploy.address;
      tokenDecimals = 18;
    } else {
      throw new Error("Currency must be 'weth' or 'usdc'");
    }

    const token = await ethers.getContractAt("MockERC20", tokenAddress);

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

    const swapAmount = ethers.parseUnits(amount, tokenDecimals);
    const zeroForOne = zeroforone === "true";

    console.log("Input currency:", currency.toUpperCase());
    console.log("Swap amount:", amount);
    console.log("Direction:", zeroForOne ? "WETH -> USDC" : "USDC -> WETH");

    // Mint tokens
    console.log("\n[1/4] Minting tokens...");
    const mintTx = await token.mint(signer.address, swapAmount);
    await mintTx.wait();
    console.log("✅ Minted", amount, currency.toUpperCase());

    // Approve PoolManager
    console.log("\n[2/4] Approving PoolManager...");
    const approveTx = await token.approve(poolManagerAddress, swapAmount);
    await approveTx.wait();
    console.log("✅ Approved");

    // Execute swap
    console.log("\n[3/4] Executing swap...");
    console.log("This will trigger beforeSwap and afterSwap hooks!");

    const poolManagerAbi = require("@uniswap/v4-core/out/IPoolManager.sol/IPoolManager.json").abi;
    const poolManager = new ethers.Contract(poolManagerAddress, poolManagerAbi, signer);

    // SwapParams
    const swapParams = {
      zeroForOne: zeroForOne,
      amountSpecified: -swapAmount, // Negative for exact input
      sqrtPriceLimitX96: zeroForOne
        ? "4295128739" // Min price for zeroForOne
        : "1461446703485210103287273052203988822378723970342", // Max price for oneForZero
    };

    try {
      const tx = await poolManager.swap(poolKey, swapParams, "0x");
      const receipt = await tx.wait();
      console.log("✅ Swap executed!");
      console.log("Transaction:", receipt?.hash);
      console.log("\n🎉 beforeSwap and afterSwap hooks were triggered!");
    } catch (error: any) {
      console.error("Error executing swap:", error.message);
      if (error.message.includes("revert")) {
        console.log("\n⚠️ Swap reverted - this might be expected if:");
        console.log("  - Pool has no liquidity");
        console.log("  - Hook validation failed");
        console.log("  - Price limits exceeded");
      }
      throw error;
    }

    console.log("\n=== Swap Complete! ===\n");
  });
