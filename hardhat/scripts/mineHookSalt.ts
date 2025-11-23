import { ethers } from "hardhat";
import { keccak256, concat, getCreate2Address, solidityPacked } from "ethers";

// Hook permissions: beforeSwap + afterSwap
const BEFORE_SWAP_FLAG = 1 << 6;  // 0x4000
const AFTER_SWAP_FLAG = 1 << 7;   // 0x8000
const REQUIRED_FLAGS = BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG; // 0xC000

async function main() {
  console.log("\n=== Mining Valid Hook Address ===\n");
  console.log(`Required flags: 0x${REQUIRED_FLAGS.toString(16)} (beforeSwap + afterSwap)\n`);

  const [deployer] = await ethers.getSigners();

  // Get actual deployment addresses
  const poolManagerAddress = process.env.POOL_MANAGER || ethers.ZeroAddress;
  const relayerAddress = deployer.address;
  const pythAddress = process.env.PYTH_ADDRESS || ethers.ZeroAddress;
  const settlementLibAddress = process.env.SETTLEMENT_LIB || ethers.ZeroAddress;

  console.log("Constructor args:");
  console.log(`  PoolManager: ${poolManagerAddress}`);
  console.log(`  Relayer: ${relayerAddress}`);
  console.log(`  Pyth: ${pythAddress}`);
  console.log(`  SettlementLib: ${settlementLibAddress}\n`);

  // Get bytecode
  const PrivacyPoolHook = await ethers.getContractFactory("PrivacyPoolHook", {
    libraries: {
      SettlementLib: settlementLibAddress,
    },
  });

  const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address"],
    [poolManagerAddress, relayerAddress, pythAddress]
  );

  const initCode = concat([PrivacyPoolHook.bytecode, constructorArgs]);
  const initCodeHash = keccak256(initCode);

  // Standard CREATE2 factory
  const create2Factory = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

  console.log("Mining salt...\n");

  for (let i = 0; i < 1000000; i++) {
    const salt = "0x" + i.toString(16).padStart(64, "0");

    const computedAddress = getCreate2Address(create2Factory, salt, initCodeHash);
    const addressNum = BigInt(computedAddress);
    const flags = Number(addressNum & 0xFFFFn);

    if ((flags & REQUIRED_FLAGS) === REQUIRED_FLAGS) {
      console.log("✅ FOUND VALID ADDRESS!\n");
      console.log(`Salt: ${salt}`);
      console.log(`Address: ${computedAddress}`);
      console.log(`Flags: 0x${flags.toString(16).padStart(4, "0")}\n`);

      console.log("Add to your .env:");
      console.log(`HOOK_SALT=${salt}`);
      console.log(`HOOK_ADDRESS=${computedAddress}\n`);

      process.exit(0);
    }

    if (i % 50000 === 0 && i > 0) {
      console.log(`Tried ${i.toLocaleString()} salts...`);
    }
  }

  console.log("\n❌ No valid address found. Increase iterations.");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
