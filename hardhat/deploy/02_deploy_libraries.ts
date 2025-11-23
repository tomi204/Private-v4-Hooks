import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("\n=== Deploying Libraries ===\n");

  // Deploy SettlementLib
  const settlementLib = await deploy("SettlementLib", {
    from: deployer,
    log: true,
  });
  console.log(`SettlementLib deployed at: ${settlementLib.address}`);

  console.log("\n=== Libraries Deployed ===\n");
};

export default func;
func.id = "deploy_libraries";
func.tags = ["libraries", "SettlementLib"];
func.dependencies = ["dependencies"];
