import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  console.log("\n=== Deploying PrivacyPoolHook ===\n");

  // Get deployed dependencies
  const poolManager = await get("PoolManager");
  const mockPyth = await get("MockPyth");
  const settlementLib = await get("SettlementLib");

  // For testing/demo, use deployer as relayer
  // In production, you should use a dedicated relayer address
  const relayerAddress = deployer;

  // Deploy TestablePrivacyPoolHook with library linking (skips address validation for testing)
  const privacyPoolHook = await deploy("PrivacyPoolHook", {
    contract: "TestablePrivacyPoolHook",
    from: deployer,
    args: [poolManager.address, relayerAddress, mockPyth.address],
    libraries: {
      SettlementLib: settlementLib.address,
    },
    log: true,
  });

  console.log(`PrivacyPoolHook deployed at: ${privacyPoolHook.address}`);
  console.log(`  - PoolManager: ${poolManager.address}`);
  console.log(`  - Relayer: ${relayerAddress}`);
  console.log(`  - Pyth Oracle: ${mockPyth.address}`);
  console.log(`  - SettlementLib: ${settlementLib.address}`);

  // Fund the hook with ETH for Pyth fees and operations
  const hook = await ethers.getContractAt("PrivacyPoolHook", privacyPoolHook.address);
  const signer = await ethers.getSigner(deployer);

  // Use less ETH for testnet
  const fundAmount = hre.network.name === "sepolia" ? "0.01" : "10";

  console.log(`\nFunding hook with ${fundAmount} ETH for operations...`);
  const fundTx = await signer.sendTransaction({
    to: privacyPoolHook.address,
    value: ethers.parseEther(fundAmount),
  });
  await fundTx.wait();
  console.log(`Hook funded with ${fundAmount} ETH`);

  console.log("\n=== PrivacyPoolHook Deployed ===\n");
};

export default func;
func.id = "deploy_privacy_pool_hook";
func.tags = ["hook", "PrivacyPoolHook"];
func.dependencies = ["uniswap", "libraries"];
