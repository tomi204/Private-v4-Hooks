import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task("deploy-hook", "Deploy PrivacyPoolHook contract")
  .setAction(async (_, hre: HardhatRuntimeEnvironment) => {
    const { ethers, deployments } = hre;
    const { get } = deployments;

    console.log("\n=== Deploying PrivacyPoolHook ===\n");

    // Get dependencies
    const poolManager = await get("PoolManager");
    const settlementLib = await get("SettlementLib");
    const pythAddress = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21"; // Real Pyth on Sepolia

    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("PoolManager:", poolManager.address);
    console.log("Pyth:", pythAddress);
    console.log("SettlementLib:", settlementLib.address);

    // Get contract factory with library
    const PrivacyPoolHook = await ethers.getContractFactory("PrivacyPoolHook", {
      libraries: {
        SettlementLib: settlementLib.address,
      },
    });

    console.log("\nDeploying PrivacyPoolHook...");
    const hook = await PrivacyPoolHook.deploy(
      poolManager.address,
      deployer.address, // relayer
      pythAddress
    );

    await hook.waitForDeployment();
    const hookAddress = await hook.getAddress();

    console.log(`\n✅ PrivacyPoolHook deployed at: ${hookAddress}`);

    // Verify address flags
    const addressNum = BigInt(hookAddress);
    const flags = Number(addressNum & 0xFFn);
    console.log(`\nAddress flags: 0x${flags.toString(16).padStart(2, "0")}`);

    // Fund the hook
    console.log("\nFunding hook with 0.01 ETH...");
    const fundTx = await deployer.sendTransaction({
      to: hookAddress,
      value: ethers.parseEther("0.01"),
    });
    await fundTx.wait();
    console.log("✅ Hook funded");

    console.log("\n=== Deployment Complete ===\n");
    console.log(`Hook Address: ${hookAddress}`);
  });
