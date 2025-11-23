import { ethers } from "hardhat";
import { keccak256, getCreate2Address, solidityPacked } from "ethers";

// Hook permissions flags (from Uniswap V4)
const BEFORE_SWAP_FLAG = 1 << 6;  // 0x4000
const AFTER_SWAP_FLAG = 1 << 7;   // 0x8000

const requiredFlags = BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG; // 0xC000

async function main() {
  console.log("\n=== Computing Hook Address with CREATE2 ===\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Get deployment info
  const PoolManager = await ethers.getContractFactory("contracts/mocks/PoolManager.sol:PoolManager");
  const SettlementLib = await ethers.getContractFactory("SettlementLib");
  const TestablePrivacyPoolHook = await ethers.getContractFactory("TestablePrivacyPoolHook", {
    libraries: {
      SettlementLib: "0x0000000000000000000000000000000000000000", // Placeholder
    },
  });

  // Constructor arguments (replace with actual values)
  const poolManagerAddress = "0x0000000000000000000000000000000000000001"; // Replace
  const relayerAddress = deployer.address;
  const pythAddress = "0x0000000000000000000000000000000000000002"; // Replace

  const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address"],
    [poolManagerAddress, relayerAddress, pythAddress]
  );

  const initCode = ethers.concat([
    TestablePrivacyPoolHook.bytecode,
    constructorArgs,
  ]);

  const initCodeHash = keccak256(initCode);

  console.log("Required flags:", `0x${requiredFlags.toString(16).padStart(4, '0')}`);
  console.log("\nSearching for valid salt...\n");

  // CREATE2 deployer address (standard across networks)
  const create2DeployerAddress = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

  let found = false;
  let salt = BigInt(0);
  const maxIterations = 100000;

  for (let i = 0; i < maxIterations && !found; i++) {
    salt = BigInt(i);
    const saltHex = "0x" + salt.toString(16).padStart(64, "0");

    const computedAddress = getCreate2Address(
      create2DeployerAddress,
      saltHex,
      initCodeHash
    );

    const addressNumber = BigInt(computedAddress);
    const addressFlags = Number(addressNumber & BigInt(0xFFFF));

    if ((addressFlags & requiredFlags) === requiredFlags) {
      console.log("✅ Found valid address!");
      console.log("Salt:", saltHex);
      console.log("Hook address:", computedAddress);
      console.log("Address flags:", `0x${addressFlags.toString(16).padStart(4, '0')}`);
      found = true;
      break;
    }

    if (i % 10000 === 0 && i > 0) {
      console.log(`Tried ${i} iterations...`);
    }
  }

  if (!found) {
    console.log(`\n❌ No valid address found in ${maxIterations} iterations`);
    console.log("Try increasing maxIterations or using a different approach");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
