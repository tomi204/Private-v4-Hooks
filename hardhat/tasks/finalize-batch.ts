import { task } from "hardhat/config";

task("finalize-batch", "Finalize the current batch for a pool")
  .setAction(async (_, hre) => {
    const { deployments, ethers } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Finalizing Current Batch ===\n");
    console.log("Signer:", signer.address);

    // Real deployed addresses on Sepolia
    const hookAddress = "0x80B884a77Cb6167B884d3419019Df790E65440C0";
    const usdcDeploy = await deployments.get("MockERC20_USDC");
    const wethDeploy = await deployments.get("MockERC20_WETH");

    const hook = await ethers.getContractAt("PrivacyPoolHook", hookAddress);

    // Create poolKey to get poolId
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

    // Calculate poolId
    const poolId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
      )
    );

    console.log("Pool ID:", poolId);

    // Get current batch ID
    const currentBatchId = await hook.currentBatchId(poolId);
    console.log("Current Batch ID:", currentBatchId);

    if (currentBatchId === ethers.ZeroHash) {
      console.log("\n⚠️ No active batch to finalize");
      return;
    }

    // Finalize batch
    console.log("\nFinalizing batch...");
    try {
      const tx = await hook.finalizeBatch(poolId);
      const receipt = await tx.wait();
      console.log("✅ Batch finalized!");
      console.log("Transaction:", receipt?.hash);
      console.log("\nBatch ID for settlement:", currentBatchId);
      console.log("\nNext step: Run settle-batch with this batch ID");
    } catch (error: any) {
      console.error("\n❌ Error finalizing batch:", error.message);
      if (error.message.includes("ERR(9)")) {
        console.log("\n⚠️ No current batch for this pool");
      } else if (error.message.includes("ERR(17)")) {
        console.log("\n⚠️ Batch already finalized");
        console.log("Batch ID:", currentBatchId);
      } else if (error.message.includes("ERR(18)")) {
        console.log("\n⚠️ Batch has no intents");
      }
      throw error;
    }

    console.log("\n=== Finalization Complete! ===\n");
  });
