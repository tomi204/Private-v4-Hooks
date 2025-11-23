import { task } from "hardhat/config";

task("deploy-summary", "Show deployment summary")
  .setAction(async (_, hre) => {
    const { deployments } = hre;

    console.log("\n=== DEPLOYMENT SUMMARY ===\n");

    try {
      const poolManager = await deployments.get("PoolManager");
      const hook = await deployments.get("PrivacyPoolHook");
      const settlementLib = await deployments.get("SettlementLib");
      const usdc = await deployments.get("MockERC20_USDC");
      const weth = await deployments.get("MockERC20_WETH");
      const mockPyth = await deployments.get("MockPyth");
      const simpleLending = await deployments.get("SimpleLending");

      console.log("Core Contracts:");
      console.log(`  PoolManager: ${poolManager.address}`);
      console.log(`  PrivacyPoolHook: ${hook.address}`);
      console.log(`  SettlementLib: ${settlementLib.address}`);

      console.log("\nTokens:");
      console.log(`  USDC: ${usdc.address}`);
      console.log(`  WETH: ${weth.address}`);

      console.log("\nOracles & DeFi:");
      console.log(`  MockPyth: ${mockPyth.address}`);
      console.log(`  SimpleLending: ${simpleLending.address}`);

      console.log("\n✅ All contracts deployed!");
    } catch (error) {
      console.log("❌ Some contracts not deployed yet");
      console.log("Run: npx hardhat deploy --network <network>");
    }

    console.log("\n");
  });
