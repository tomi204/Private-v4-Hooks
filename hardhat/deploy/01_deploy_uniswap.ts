import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("\n=== Deploying Uniswap V4 Infrastructure ===\n");

  // Deploy PoolManager
  const poolManager = await deploy("PoolManager", {
    contract: "contracts/mocks/PoolManager.sol:PoolManager",
    from: deployer,
    args: [deployer], // owner
    log: true,
  });
  console.log(`PoolManager deployed at: ${poolManager.address}`);

  console.log("\n=== Uniswap V4 Infrastructure Deployed ===\n");
};

export default func;
func.id = "deploy_uniswap";
func.tags = ["uniswap", "PoolManager"];
func.dependencies = ["dependencies"];
