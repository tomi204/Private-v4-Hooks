import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;
  const { ethers } = hre;

  console.log("\n=== Deploying REAL PrivacyPoolHook ===\n");

  // Get deployed dependencies
  const poolManager = await get("PoolManager");
  const settlementLib = await get("SettlementLib");

  // Use real Pyth on Sepolia, mock for local
  let pythAddress: string;
  if (hre.network.name === "sepolia") {
    pythAddress = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21"; // Real Pyth on Sepolia
  } else {
    const mockPyth = await get("MockPyth");
    pythAddress = mockPyth.address;
  }

  const relayerAddress = deployer;

  console.log("Deployment config:");
  console.log(`  PoolManager: ${poolManager.address}`);
  console.log(`  Relayer: ${relayerAddress}`);
  console.log(`  Pyth: ${pythAddress}`);
  console.log(`  SettlementLib: ${settlementLib.address}\n`);

  // Deploy without CREATE2 for now (address validation is skipped in mock PoolManager)
  console.log("⚠️  Deploying without CREATE2");
  console.log("Note: For production Uniswap V4, you need a valid hook address");
  console.log("To mine a valid salt:");
  console.log(`  POOL_MANAGER=${poolManager.address} PYTH_ADDRESS=${pythAddress} SETTLEMENT_LIB=${settlementLib.address} npx hardhat run scripts/mineHookSalt.ts --network sepolia\n`);

  const privacyPoolHook = await deploy("PrivacyPoolHook", {
    contract: "PrivacyPoolHook",
    from: deployer,
    args: [poolManager.address, relayerAddress, pythAddress],
    libraries: {
      SettlementLib: settlementLib.address,
    },
    log: true,
    waitConfirmations: 1,
  });

  console.log(`\n✅ PrivacyPoolHook deployed at: ${privacyPoolHook.address}`);

  // Verify address flags
  const addressNum = BigInt(privacyPoolHook.address);
  const flags = Number(addressNum & 0xFFFFn);
  const requiredFlags = 0xC000; // beforeSwap + afterSwap

  console.log(`\nAddress validation:`);
  console.log(`  Address: ${privacyPoolHook.address}`);
  console.log(`  Flags: 0x${flags.toString(16).padStart(4, "0")}`);
  console.log(`  Required: 0x${requiredFlags.toString(16).padStart(4, "0")}`);

  if ((flags & requiredFlags) === requiredFlags) {
    console.log(`  ✅ Valid hook address!`);
  } else {
    console.log(`  ⚠️  Invalid address - will fail with real Uniswap V4 PoolManager`);
  }

  // Fund hook
  const fundAmount = hre.network.name === "sepolia" ? "0.01" : "1";
  console.log(`\nFunding hook with ${fundAmount} ETH...`);

  try {
    const signer = await ethers.getSigner(deployer);
    const fundTx = await signer.sendTransaction({
      to: privacyPoolHook.address,
      value: ethers.parseEther(fundAmount),
    });
    await fundTx.wait();
    console.log(`✅ Hook funded with ${fundAmount} ETH`);
  } catch (error: any) {
    console.log(`⚠️  Could not fund hook: ${error.message}`);
  }

  console.log("\n=== PrivacyPoolHook Deployed ===\n");
};

export default func;
func.id = "deploy_privacy_pool_hook";
func.tags = ["hook", "PrivacyPoolHook"];
func.dependencies = ["uniswap", "libraries"];
