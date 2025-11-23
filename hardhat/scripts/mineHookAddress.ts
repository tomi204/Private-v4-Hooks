import { ethers } from "hardhat";
import { keccak256, concat, getCreate2Address } from "ethers";
import * as fs from "fs";

// Hook permission flags
const BEFORE_SWAP_FLAG = 1 << 6;  // 0x4000
const AFTER_SWAP_FLAG = 1 << 7;   // 0x8000
const REQUIRED_FLAGS = BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG; // 0xC000

async function main() {
  console.log("\n=== Mining Hook Address with Valid Flags ===\n");
  console.log(`Required flags: 0x${REQUIRED_FLAGS.toString(16).padStart(4, '0')}`);
  console.log("This means the address must end with certain hex digits\n");

  // Get constructor args (you'll need to update these with actual deployed addresses)
  const poolManagerAddress = process.env.POOL_MANAGER_ADDRESS || ethers.ZeroAddress;
  const relayerAddress = process.env.RELAYER_ADDRESS || ethers.ZeroAddress;
  const pythAddress = process.env.PYTH_ADDRESS || ethers.ZeroAddress;

  console.log("Constructor args:");
  console.log(`  PoolManager: ${poolManagerAddress}`);
  console.log(`  Relayer: ${relayerAddress}`);
  console.log(`  Pyth: ${pythAddress}\n`);

  // Get bytecode
  const SettlementLib = await ethers.getContractFactory("SettlementLib");
  const settlementLibAddress = process.env.SETTLEMENT_LIB_ADDRESS || ethers.ZeroAddress;

  const TestablePrivacyPoolHook = await ethers.getContractFactory("TestablePrivacyPoolHook", {
    libraries: {
      SettlementLib: settlementLibAddress,
    },
  });

  const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address"],
    [poolManagerAddress, relayerAddress, pythAddress]
  );

  const initCode = concat([
    TestablePrivacyPoolHook.bytecode,
    constructorArgs,
  ]);

  const initCodeHash = keccak256(initCode);

  console.log("Init code hash:", initCodeHash);
  console.log("\nMining for valid salt...\n");

  // Use deployer address as CREATE2 factory
  const [deployer] = await ethers.getSigners();
  const create2Factory = deployer.address; // In reality, you'd use a standard CREATE2 factory

  let found = false;
  let bestSalt = 0n;
  let bestAddress = "";
  const maxIterations = 1000000;

  for (let i = 0; i < maxIterations; i++) {
    const salt = BigInt(i);
    const saltBytes32 = "0x" + salt.toString(16).padStart(64, "0");

    // Compute CREATE2 address
    const computedAddress = getCreate2Address(
      create2Factory,
      saltBytes32,
      initCodeHash
    );

    // Check flags
    const addressBigInt = BigInt(computedAddress);
    const addressFlags = Number(addressBigInt & 0xFFFFn);

    // Check if this address has the required flags
    if ((addressFlags & REQUIRED_FLAGS) === REQUIRED_FLAGS) {
      bestSalt = salt;
      bestAddress = computedAddress;
      found = true;

      console.log("✅ FOUND VALID ADDRESS!");
      console.log(`\nSalt: ${salt}`);
      console.log(`Salt (hex): ${saltBytes32}`);
      console.log(`Address: ${computedAddress}`);
      console.log(`Address flags: 0x${addressFlags.toString(16).padStart(4, '0')}`);

      // Save to file
      const config = {
        salt: saltBytes32,
        address: computedAddress,
        flags: `0x${addressFlags.toString(16).padStart(4, '0')}`,
        poolManager: poolManagerAddress,
        relayer: relayerAddress,
        pyth: pythAddress,
        settlementLib: settlementLibAddress,
      };

      fs.writeFileSync(
        "hook-address-config.json",
        JSON.stringify(config, null, 2)
      );

      console.log("\n✅ Configuration saved to hook-address-config.json");
      break;
    }

    if (i % 50000 === 0 && i > 0) {
      console.log(`Tried ${i.toLocaleString()} iterations...`);
    }
  }

  if (!found) {
    console.log(`\n❌ No valid address found in ${maxIterations.toLocaleString()} iterations`);
    console.log("You may need to:");
    console.log("1. Increase maxIterations");
    console.log("2. Use a different CREATE2 factory");
    console.log("3. Adjust constructor parameters");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
