import { task } from "hardhat/config";

task("set-simple-lending", "Configure SimpleLending protocol address in hook")
  .setAction(async (_, hre) => {
    const { ethers } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Configuring SimpleLending ===\n");
    console.log("Signer:", signer.address);

    // Real deployed addresses on Sepolia
    const hookAddress = "0x80B884a77Cb6167B884d3419019Df790E65440C0";
    const simpleLendingAddress = "0x3b64D86362ec9a8Cae77C661ffc95F0bbd440aa2";

    const hook = await ethers.getContractAt("PrivacyPoolHook", hookAddress);

    console.log("Hook Address:", hookAddress);
    console.log("SimpleLending Address:", simpleLendingAddress);

    console.log("\nSetting SimpleLending in hook...");

    try {
      const tx = await hook.setSimpleLending(simpleLendingAddress, {
        gasLimit: 200000
      });
      const receipt = await tx.wait();
      console.log("✅ SimpleLending configured!");
      console.log("Transaction:", receipt?.hash);

      // Verify it was set
      const currentLending = await hook.simpleLending();
      console.log("\nVerification:");
      console.log("Current SimpleLending address:", currentLending);
      console.log("Match:", currentLending.toLowerCase() === simpleLendingAddress.toLowerCase() ? "✅" : "❌");

      console.log("\n🎉 SimpleLending configuration complete!");
    } catch (error: any) {
      console.error("Error setting SimpleLending:", error.message);
      if (error.message.includes("Not authorized")) {
        console.log("\n⚠️ Authorization failed - only owner or relayer can call this");
      }
      throw error;
    }

    console.log("\n=== Configuration Complete! ===\n");
  });
