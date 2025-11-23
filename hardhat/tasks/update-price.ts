import { task } from "hardhat/config";
import axios from "axios";

task("update-price", "Update ETH/USD price from Pyth oracle")
  .setAction(async (_, hre) => {
    const { ethers } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Updating Price from Pyth Oracle ===\n");
    console.log("Signer:", signer.address);

    // Real deployed hook on Sepolia
    const hookAddress = "0x80B884a77Cb6167B884d3419019Df790E65440C0";
    const hook = await ethers.getContractAt("PrivacyPoolHook", hookAddress);

    // ETH/USD price feed ID on Pyth
    const ETH_USD_PRICE_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

    console.log("Price Feed ID:", ETH_USD_PRICE_FEED);
    console.log("Hook Address:", hookAddress);

    // Fetch price update from Pyth Hermes API
    console.log("\n[1/3] Fetching price update from Pyth...");

    const pythUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${ETH_USD_PRICE_FEED}`;

    let priceUpdateData: string;
    try {
      const response = await axios.get(pythUrl);
      if (!response.data || !response.data.binary || !response.data.binary.data || response.data.binary.data.length === 0) {
        throw new Error("No price data received from Pyth");
      }

      // Get the first update (most recent)
      priceUpdateData = "0x" + response.data.binary.data[0];
      console.log("✅ Price update fetched");
      console.log("Update data length:", priceUpdateData.length);
    } catch (error: any) {
      console.error("Error fetching price from Pyth:", error.message);
      throw error;
    }

    // Get update fee
    console.log("\n[2/3] Getting update fee...");
    const pythAddress = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21";
    const pythAbi = [
      "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 feeAmount)"
    ];
    const pyth = new ethers.Contract(pythAddress, pythAbi, signer);

    const updateFee = await pyth.getUpdateFee([priceUpdateData]);
    console.log("✅ Update fee:", ethers.formatEther(updateFee), "ETH");

    // Update price via hook
    console.log("\n[3/3] Updating price via hook...");
    console.log("Sending update fee:", ethers.formatEther(updateFee), "ETH");

    try {
      const tx = await hook.updatePriceFromPyth(priceUpdateData, {
        value: updateFee,
        gasLimit: 500000
      });
      const receipt = await tx.wait();
      console.log("✅ Price updated!");
      console.log("Transaction:", receipt?.hash);
      console.log("\n🎉 Pyth oracle price update successful!");
    } catch (error: any) {
      console.error("Error updating price:", error.message);
      if (error.message.includes("revert")) {
        console.log("\n⚠️ Update reverted - possible reasons:");
        console.log("  - Insufficient update fee");
        console.log("  - Price data expired");
        console.log("  - Invalid price feed ID");
      }
      throw error;
    }

    console.log("\n=== Price Update Complete! ===\n");
  });
