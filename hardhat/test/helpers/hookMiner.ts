import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// Hook permission flags from Uniswap V4
// Source: @uniswap/v4-core/src/libraries/Hooks.sol
export const BEFORE_INITIALIZE_FLAG = 1n << 13n;
export const AFTER_INITIALIZE_FLAG = 1n << 12n;
export const BEFORE_ADD_LIQUIDITY_FLAG = 1n << 11n;
export const AFTER_ADD_LIQUIDITY_FLAG = 1n << 10n;
export const BEFORE_REMOVE_LIQUIDITY_FLAG = 1n << 9n;
export const AFTER_REMOVE_LIQUIDITY_FLAG = 1n << 8n;
export const BEFORE_SWAP_FLAG = 1n << 7n;
export const AFTER_SWAP_FLAG = 1n << 6n;
export const BEFORE_DONATE_FLAG = 1n << 5n;
export const AFTER_DONATE_FLAG = 1n << 4n;
export const BEFORE_SWAP_RETURNS_DELTA_FLAG = 1n << 3n;
export const AFTER_SWAP_RETURNS_DELTA_FLAG = 1n << 2n;
export const AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG = 1n << 1n;
export const AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG = 1n << 0n;

const MAX_ITERATIONS = 1000000; // Increased for better chance of finding valid salt

/**
 * Find a salt that produces a hook address with the desired flags
 * @param factoryAddress Address of DeterministicDeployFactory
 * @param flags Desired hook flags (OR together the flags above)
 * @param bytecode Contract bytecode with constructor args encoded
 * @returns {salt, hookAddress} The salt to use and the resulting address
 */
export async function findSalt(
  factoryAddress: string,
  flags: bigint,
  bytecode: string
): Promise<{ salt: bigint; hookAddress: string }> {
  const factory = await ethers.getContractAt("DeterministicDeployFactory", factoryAddress);

  // Mask to check bottom 14 bits (hook flags)
  const FLAG_MASK = 0x3FFFn;
  const targetFlags = flags & FLAG_MASK;

  for (let salt = 0n; salt < BigInt(MAX_ITERATIONS); salt++) {
    const computedAddress = await factory.computeAddress(bytecode, salt);
    const addressBits = BigInt(computedAddress) & FLAG_MASK;

    if (salt % 10000n === 0n && salt > 0n) {
      console.log(`  Searching... tried ${salt} salts so far`);
    }

    if (addressBits === targetFlags) {
      return { salt, hookAddress: computedAddress };
    }
  }

  throw new Error(`Could not find salt with flags ${flags.toString(16)} after ${MAX_ITERATIONS} iterations`);
}

/**
 * Deploy a hook with the correct address using CREATE2
 * @param deployer Signer to deploy from
 * @param contractName Name of hook contract
 * @param constructorArgs Constructor arguments
 * @param flags Required hook flags
 * @returns Deployed contract instance
 */
export async function deployHookWithCorrectAddress(
  deployer: HardhatEthersSigner,
  contractName: string,
  constructorArgs: any[],
  flags: bigint
) {
  // Deploy factory
  const FactoryFactory = await ethers.getContractFactory("DeterministicDeployFactory");
  const factory = await FactoryFactory.connect(deployer).deploy();
  await factory.waitForDeployment();

  // Get contract factory and encode constructor
  const ContractFactory = await ethers.getContractFactory(contractName);
  const deployTx = await ContractFactory.getDeployTransaction(...constructorArgs);
  const bytecode = deployTx.data as string;

  // Find salt
  console.log(`Finding salt for ${contractName} with flags ${flags.toString(16)}...`);
  const { salt, hookAddress } = await findSalt(await factory.getAddress(), flags, bytecode);
  console.log(`Found salt ${salt} -> address ${hookAddress}`);

  // Deploy with CREATE2
  const tx = await factory.deploy(bytecode, salt);
  await tx.wait();

  // Return contract instance at the deterministic address
  return await ethers.getContractAt(contractName, hookAddress);
}
