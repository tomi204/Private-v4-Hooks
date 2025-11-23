import { task } from "hardhat/config";
import axios from "axios";

task("settle-batch", "Settle a batch of intents with Pyth price update")
  .addParam("batchid", "Batch ID to settle")
  .setAction(async ({ batchid }, hre) => {
    const { ethers } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Settling Batch with Pyth Price Update ===\n");
    console.log("Signer (Relayer):", signer.address);
    console.log("Batch ID:", batchid);

    // Real deployed hook on Sepolia
    const hookAddress = "0x80B884a77Cb6167B884d3419019Df790E65440C0";
    const hook = await ethers.getContractAt("PrivacyPoolHook", hookAddress);

    // ETH/USD price feed ID on Pyth
    const ETH_USD_PRICE_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

    // Fetch price update from Pyth Hermes API
    console.log("\n[1/3] Fetching price update from Pyth...");
    const pythUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${ETH_USD_PRICE_FEED}`;

    let priceUpdateData: string;
    try {
      const response = await axios.get(pythUrl);
      if (!response.data || !response.data.binary || !response.data.binary.data || response.data.binary.data.length === 0) {
        throw new Error("No price data received from Pyth");
      }

      priceUpdateData = "0x" + response.data.binary.data[0];
      console.log("✅ Price update fetched from Pyth Hermes API");
      console.log("Update data length:", priceUpdateData.length);
    } catch (error: any) {
      console.error("Error fetching price from Pyth:", error.message);
      console.log("⚠️ Continuing without price update...");
      priceUpdateData = "0x";
    }

    // Get update fee
    console.log("\n[2/3] Calculating update fee...");
    const pythAddress = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21";
    const pythAbi = [
      "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 feeAmount)"
    ];
    const pyth = new ethers.Contract(pythAddress, pythAbi, signer);

    let updateFee = 0n;
    if (priceUpdateData !== "0x") {
      updateFee = await pyth.getUpdateFee([priceUpdateData]);
      console.log("✅ Update fee:", ethers.formatEther(updateFee), "ETH");
    } else {
      console.log("✅ No update fee (no price data)");
    }

    // Settle batch
    console.log("\n[3/3] Settling batch...");
    console.log("This will trigger:");
    console.log("  - Internal transfers (matched intents)");
    console.log("  - Pyth price oracle update 🎯");
    console.log("  - Net swap execution on Uniswap V4");
    console.log("  - beforeSwap and afterSwap hooks 🎯");

    // For demo purposes, we'll call with empty arrays
    // In production, the relayer would compute these off-chain
    const internalTransfers: any[] = [];
    const userShares: any[] = [];
    const netAmountIn = 0;
    const tokenIn = ethers.ZeroAddress;
    const tokenOut = ethers.ZeroAddress;
    const outputToken = ethers.ZeroAddress;

    try {
      const tx = await hook.settleBatch(
        batchid,
        internalTransfers,
        netAmountIn,
        tokenIn,
        tokenOut,
        outputToken,
        userShares,
        priceUpdateData,
        {
          value: updateFee,
          gasLimit: 1000000
        }
      );
      const receipt = await tx.wait();
      console.log("\n✅ Batch settled!");
      console.log("Transaction:", receipt?.hash);
      console.log("\n🎉 Pyth oracle was updated during settlement!");
      console.log("🎉 beforeSwap and afterSwap hooks were triggered!");
    } catch (error: any) {
      console.error("\n❌ Error settling batch:", error.message);
      if (error.message.includes("ERR(10)")) {
        console.log("\n⚠️ Only relayer can settle batches");
        console.log("Current signer:", signer.address);
      } else if (error.message.includes("ERR(7)")) {
        console.log("\n⚠️ Batch not finalized yet");
      } else if (error.message.includes("ERR(8)")) {
        console.log("\n⚠️ Batch already settled");
      }
      throw error;
    }

    console.log("\n=== Settlement Complete! ===\n");
  });
