import { expect } from "chai";
import hre, { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { PrivacyPoolHook, PoolEncryptedToken } from "../../types";

// Types
export type PoolKey = {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
};

// Constants
export const PUBLIC_DECRYPT_ATTEMPTS = 10;

/**
 * Mine a single block
 */
export async function mineBlock() {
  await hre.network.provider.send("evm_mine");
}

/**
 * Wait for oracle with multiple blocks
 */
export async function waitForOracle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await mineBlock();
  }
}

/**
 * Decrypt encrypted balance from PoolEncryptedToken (ERC7984)
 */
export async function decryptBalance(
  token: PoolEncryptedToken,
  signer: HardhatEthersSigner,
  user: string,
): Promise<bigint> {
  try {
    const handle = await token.confidentialBalanceOf(user);
    if (handle === ethers.ZeroHash || handle === "0x") {
      return 0n;
    }
    const decrypted = await fhevm.userDecryptEuint(FhevmType.euint64, handle, await token.getAddress(), signer);
    return BigInt(decrypted);
  } catch (error) {
    if (
      error instanceof Error &&
      (/Invalid block filter/i.test(error.message) || /Handle .* does not exist/i.test(error.message))
    ) {
      try {
        const handle = await token.confidentialBalanceOf(user);
        if (handle === ethers.ZeroHash || handle === "0x") {
          return 0n;
        }
        const decrypted = await fhevm.userDecryptEuint(FhevmType.euint64, handle, await token.getAddress(), signer);
        return BigInt(decrypted);
      } catch {
        return 0n;
      }
    }
    return 0n;
  }
}

/**
 * Decrypt a single public handle with retry
 */
export async function decryptHandle(handle: string | { toString(): string }): Promise<bigint> {
  const hex = typeof handle === "string" ? handle : handle.toString();
  if (hex === ethers.ZeroHash || hex === "0x") {
    return 0n;
  }
  for (let i = 0; i < 3; i++) {
    try {
      const record = await fhevm.publicDecrypt([hex as `0x${string}`]);
      const keyHandle = hex as `0x${string}`;
      return BigInt(record.clearValues[keyHandle]);
    } catch (error) {
      if (i < 2) {
        await mineBlock();
      } else {
        throw error;
      }
    }
  }
  throw new Error("Failed to decrypt handle");
}

/**
 * Decrypt multiple public handles with retry
 */
export async function decryptPublicHandles(handles: readonly string[]): Promise<bigint[]> {
  if (handles.length === 0) {
    return [];
  }

  let lastError: unknown;
  const typedHandles = handles.map((h) => h as `0x${string}`);

  for (let attempt = 0; attempt < PUBLIC_DECRYPT_ATTEMPTS; attempt += 1) {
    try {
      const record = await fhevm.publicDecrypt(typedHandles);

      return typedHandles.map((handle) => {
        const raw = record.clearValues[handle];
        if (raw === undefined) {
          throw new Error(`Missing decrypted value for handle ${handle}`);
        }
        return BigInt(raw);
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (!/Invalid block filter/i.test(error.message) && !/Handle .* does not exist/i.test(error.message))
      ) {
        throw error;
      }

      lastError = error;
      await mineBlock();
    }
  }

  throw lastError instanceof Error ? lastError : new Error("failed to decrypt handles");
}

/**
 * Decrypt encrypted action (euint8)
 */
export async function decryptAction(
  hook: PrivacyPoolHook,
  intentId: string,
  relayer: HardhatEthersSigner,
): Promise<number> {
  try {
    const intent = await hook.intents(intentId);
    const actionHandle = intent.encryptedAction;

    if (actionHandle === ethers.ZeroHash || actionHandle === "0x") {
      return 0;
    }

    const decrypted = await fhevm.userDecryptEuint(FhevmType.euint8, actionHandle, await hook.getAddress(), relayer);
    return Number(decrypted);
  } catch (error) {
    console.error("Error decrypting action:", error);
    return 0;
  }
}

/**
 * Helper to create encrypted input for amount (euint64)
 */
export async function createEncryptedAmount(
  contractAddress: string,
  userAddress: string,
  amount: bigint,
): Promise<{ handle: string; proof: string }> {
  const builder = await fhevm.createEncryptedInput(contractAddress, userAddress);
  builder.add64(Number(amount));
  const encrypted = await builder.encrypt();
  return {
    handle: encrypted.handles[0],
    proof: encrypted.inputProof,
  };
}

/**
 * Helper to create encrypted input for action (euint8)
 */
export async function createEncryptedAction(
  contractAddress: string,
  userAddress: string,
  action: number,
): Promise<{ handle: string; proof: string }> {
  const builder = await fhevm.createEncryptedInput(contractAddress, userAddress);
  builder.add8(action);
  const encrypted = await builder.encrypt();
  return {
    handle: encrypted.handles[0],
    proof: encrypted.inputProof,
  };
}

/**
 * Helper to submit intent with encrypted amount and action
 */
export async function submitIntent(
  hook: PrivacyPoolHook,
  user: HardhatEthersSigner,
  poolKey: PoolKey,
  inputCurrency: string,
  amount: bigint,
  action: number,
  deadline: number = 0,
): Promise<string> {
  const hookAddress = await hook.getAddress();
  const userAddress = user.address;

  // Create encrypted inputs
  const encAmount = await createEncryptedAmount(hookAddress, userAddress, amount);
  const encAction = await createEncryptedAction(hookAddress, userAddress, action);

  // Submit intent
  const tx = await hook
    .connect(user)
    .submitIntent(
      poolKey,
      inputCurrency,
      encAmount.handle,
      encAmount.proof,
      encAction.handle,
      encAction.proof,
      deadline,
    );

  const receipt = await tx.wait();
  await mineBlock();

  // Find IntentSubmitted event
  const event = receipt?.logs.find((log) => {
    try {
      const parsed = hook.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      return parsed?.name === "IntentSubmitted";
    } catch {
      return false;
    }
  });

  if (!event) throw new Error("IntentSubmitted event not found");

  const parsed = hook.interface.parseLog({
    topics: event.topics as string[],
    data: event.data,
  });

  return parsed?.args[4]; // intentId
}
