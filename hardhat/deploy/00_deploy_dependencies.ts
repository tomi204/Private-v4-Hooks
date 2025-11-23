import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("\n=== Deploying Base Dependencies ===\n");

  // Deploy MockERC20 tokens (USDC)
  const usdc = await deploy("MockERC20_USDC", {
    contract: "MockERC20",
    from: deployer,
    args: ["USD Coin", "USDC", 6],
    log: true,
  });
  console.log(`USDC deployed at: ${usdc.address}`);

  // Deploy MockERC20 tokens (WETH)
  const weth = await deploy("MockERC20_WETH", {
    contract: "MockERC20",
    from: deployer,
    args: ["Wrapped Ether", "WETH", 18],
    log: true,
  });
  console.log(`WETH deployed at: ${weth.address}`);

  // Use real Pyth contract on Sepolia or deploy mock for local testing
  let pythAddress: string;
  if (hre.network.name === "sepolia") {
    // Real Pyth contract on Sepolia
    pythAddress = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21";
    console.log(`Using real Pyth on Sepolia: ${pythAddress}`);
  } else {
    // Deploy MockPyth for local testing
    const mockPyth = await deploy("MockPyth", {
      contract: "contracts/mocks/MockPyth.sol:MockPyth",
      from: deployer,
      args: [60, 1], // validTimePeriod: 60s, singleUpdateFee: 1 wei
      log: true,
    });
    pythAddress = mockPyth.address;
    console.log(`MockPyth deployed at: ${pythAddress}`);
  }

  // Deploy SimpleLending (needed for liquidity management)
  const simpleLending = await deploy("SimpleLending", {
    from: deployer,
    args: [usdc.address],
    log: true,
  });
  console.log(`SimpleLending deployed at: ${simpleLending.address}`);

  console.log("\n=== Base Dependencies Deployed ===\n");
};

export default func;
func.id = "deploy_dependencies";
func.tags = ["dependencies", "MockERC20", "SimpleLending"];
