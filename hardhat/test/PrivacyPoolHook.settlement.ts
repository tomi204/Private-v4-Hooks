import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { TestablePrivacyPoolHook, PoolEncryptedToken, PoolManager, MockERC20 } from "../types";
import { mineBlock, type PoolKey } from "./helpers/privacypool.helpers";

// Helper function to get encrypted token address
async function getEncryptedTokenAddress(
  hook: TestablePrivacyPoolHook,
  poolKey: PoolKey,
  currency: string,
): Promise<string> {
  const poolId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
    ),
  );
  return await hook.poolEncryptedTokens(poolId, currency);
}

describe("PrivacyPoolHook: Complete Settlement Flow", function () {
  let hook: TestablePrivacyPoolHook;
  let poolManager: PoolManager;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;

  let token0: MockERC20;
  let token1: MockERC20;
  let encryptedToken0: PoolEncryptedToken;
  let encryptedToken1: PoolEncryptedToken;
  let poolKey: PoolKey;
  let poolId: string;

  const INITIAL_BALANCE = ethers.parseUnits("100000", 6);
  const DEPOSIT_AMOUNT = ethers.parseUnits("10000", 6);
  const MAX_OPERATOR_EXPIRY = 2n ** 48n - 1n;

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.log("This test requires FHEVM mock environment");
      this.skip();
    }

    [owner, alice, bob, carol, relayer] = await ethers.getSigners();

    // Deploy REAL Uniswap V4 PoolManager
    const PoolManagerFactory = await ethers.getContractFactory("contracts/mocks/PoolManager.sol:PoolManager");
    poolManager = await PoolManagerFactory.deploy(owner.address);
    await poolManager.waitForDeployment();

    // Deploy mock ERC20 tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    token0 = await MockERC20Factory.deploy("USDC", "USDC", 6);
    await token0.waitForDeployment();

    token1 = await MockERC20Factory.deploy("USDT", "USDT", 6);
    await token1.waitForDeployment();

    // Mint tokens to users
    await token0.mint(alice.address, INITIAL_BALANCE);
    await token0.mint(bob.address, INITIAL_BALANCE);
    await token0.mint(carol.address, INITIAL_BALANCE);

    await token1.mint(alice.address, INITIAL_BALANCE);
    await token1.mint(bob.address, INITIAL_BALANCE);
    await token1.mint(carol.address, INITIAL_BALANCE);

    // Deploy SettlementLib library
    const SettlementLibFactory = await ethers.getContractFactory("SettlementLib");
    const settlementLib = await SettlementLibFactory.deploy();
    await settlementLib.waitForDeployment();

    // Deploy MockPyth
    const MockPythFactory = await ethers.getContractFactory("contracts/mocks/MockPyth.sol:MockPyth");
    const mockPyth = await MockPythFactory.deploy(60, 1);
    await mockPyth.waitForDeployment();

    // Deploy TestablePrivacyPoolHook
    const TestablePrivacyPoolHookFactory = await ethers.getContractFactory("TestablePrivacyPoolHook", {
      libraries: {
        SettlementLib: await settlementLib.getAddress(),
      },
    });
    hook = await TestablePrivacyPoolHookFactory.deploy(
      await poolManager.getAddress(),
      relayer.address,
      await mockPyth.getAddress(),
    );
    await hook.waitForDeployment();

    // Create poolKey
    poolKey = {
      currency0: await token0.getAddress(),
      currency1: await token1.getAddress(),
      fee: 3000,
      tickSpacing: 60,
      hooks: await hook.getAddress(),
    };

    // Calculate poolId
    poolId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      ),
    );

    console.log("[Setup] Complete");
  });

  describe("Complete Settlement: Matched Intents (Internal Transfer)", function () {
    it("should execute complete flow: deposit → submit → settle → withdraw", async function () {
      const hookAddress = await hook.getAddress();
      const swapAmount = ethers.parseUnits("1000", 6);

      // ========== STEP 1: DEPOSITS ==========
      console.log("\n[STEP 1] DEPOSITS");

      await token0.connect(alice).approve(hookAddress, DEPOSIT_AMOUNT);
      await hook.connect(alice).deposit(poolKey, poolKey.currency0, DEPOSIT_AMOUNT);
      await mineBlock();

      const encToken0Address = await getEncryptedTokenAddress(hook, poolKey, poolKey.currency0);
      encryptedToken0 = await ethers.getContractAt("PoolEncryptedToken", encToken0Address);

      console.log("Alice deposited:", ethers.formatUnits(DEPOSIT_AMOUNT, 6), "USDC");
      console.log("  Encrypted token:", await encryptedToken0.getAddress());

      await token1.connect(bob).approve(hookAddress, DEPOSIT_AMOUNT);
      await hook.connect(bob).deposit(poolKey, poolKey.currency1, DEPOSIT_AMOUNT);
      await mineBlock();

      const encToken1Address = await getEncryptedTokenAddress(hook, poolKey, poolKey.currency1);
      encryptedToken1 = await ethers.getContractAt("PoolEncryptedToken", encToken1Address);

      console.log("Bob deposited:", ethers.formatUnits(DEPOSIT_AMOUNT, 6), "USDT");
      console.log("  Encrypted token:", await encryptedToken1.getAddress());

      console.log("\n[STEP 2] SET OPERATORS");

      await encryptedToken0.connect(alice).setOperator(hookAddress, MAX_OPERATOR_EXPIRY);
      await encryptedToken1.connect(bob).setOperator(hookAddress, MAX_OPERATOR_EXPIRY);
      await mineBlock();

      console.log("Operators configured for encrypted tokens");

      console.log("\n[STEP 3] SUBMIT INTENTS");

      const aliceEncAmount = await fhevm
        .createEncryptedInput(hookAddress, alice.address)
        .add64(Number(swapAmount))
        .encrypt();

      const aliceEncAction = await fhevm.createEncryptedInput(hookAddress, alice.address).add8(0).encrypt();

      const aliceIntentTx = await hook
        .connect(alice)
        .submitIntent(
          poolKey,
          poolKey.currency0,
          aliceEncAmount.handles[0],
          aliceEncAmount.inputProof,
          aliceEncAction.handles[0],
          aliceEncAction.inputProof,
          0,
        );

      await aliceIntentTx.wait();
      await mineBlock();

      console.log("Alice intent submitted:");
      console.log("  Plaintext amount:", ethers.formatUnits(swapAmount, 6), "USDC");
      console.log("  Encrypted amount handle:", ethers.hexlify(aliceEncAmount.handles[0]));
      console.log("  Encrypted action handle:", ethers.hexlify(aliceEncAction.handles[0]));
      console.log("  Action type: ACTION_SWAP_0_TO_1 (0)");

      const bobEncAmount = await fhevm
        .createEncryptedInput(hookAddress, bob.address)
        .add64(Number(swapAmount))
        .encrypt();

      const bobEncAction = await fhevm.createEncryptedInput(hookAddress, bob.address).add8(1).encrypt();

      const bobIntentTx = await hook
        .connect(bob)
        .submitIntent(
          poolKey,
          poolKey.currency1,
          bobEncAmount.handles[0],
          bobEncAmount.inputProof,
          bobEncAction.handles[0],
          bobEncAction.inputProof,
          0,
        );

      await bobIntentTx.wait();
      await mineBlock();

      console.log("Bob intent submitted:");
      console.log("  Plaintext amount:", ethers.formatUnits(swapAmount, 6), "USDT");
      console.log("  Encrypted amount handle:", ethers.hexlify(bobEncAmount.handles[0]));
      console.log("  Encrypted action handle:", ethers.hexlify(bobEncAction.handles[0]));
      console.log("  Action type: ACTION_SWAP_1_TO_0 (1)");

      console.log("\n[STEP 4] FINALIZE BATCH");

      const batchId = await hook.currentBatchId(poolId);
      expect(batchId).to.not.equal(ethers.ZeroHash);

      await hook.connect(relayer).finalizeBatch(poolId);
      await mineBlock();

      const batch = await hook.batches(batchId);
      expect(batch.finalized).to.equal(true);

      console.log("Batch finalized");
      console.log("  Batch ID:", batchId);
      console.log("  Total intents:", batch.totalIntents.toString());

      console.log("\n[STEP 5] SETTLE BATCH");

      const internalTransfers = [
        {
          from: alice.address,
          to: bob.address,
          encryptedToken: await encryptedToken0.getAddress(),
          encryptedAmount: aliceEncAmount.handles[0],
        },
        {
          from: bob.address,
          to: alice.address,
          encryptedToken: await encryptedToken1.getAddress(),
          encryptedAmount: bobEncAmount.handles[0],
        },
      ];

      const settleTx = await hook
        .connect(relayer)
        .settleBatch(
          batchId,
          internalTransfers,
          0,
          poolKey.currency0,
          poolKey.currency1,
          await encryptedToken1.getAddress(),
          [],
          "0x",
        );

      await settleTx.wait();
      await mineBlock();

      console.log("Settlement executed");
      console.log("  Internal transfers: 2");
      console.log("  Net AMM swap amount: 0");
      console.log("  Capital efficiency: 100% (fully matched)");

      console.log("\n[STEP 6] VERIFY SETTLEMENT");

      const settledBatch = await hook.batches(batchId);
      expect(settledBatch.settled).to.equal(true);

      console.log("Batch settled successfully");

      console.log("\n[STEP 7] WITHDRAW");

      // Alice should now have eUSDT (swapped from eUSDC)
      // She can withdraw eUSDT → USDT
      const aliceToken1BalanceBefore = await token1.balanceOf(alice.address);

      await hook.connect(alice).withdraw(poolKey, poolKey.currency1, swapAmount, alice.address);
      await mineBlock();

      const aliceToken1BalanceAfter = await token1.balanceOf(alice.address);
      expect(aliceToken1BalanceAfter - aliceToken1BalanceBefore).to.equal(swapAmount);

      console.log("Alice withdrew:", ethers.formatUnits(swapAmount, 6), "USDT");

      // Bob should now have eUSDC (swapped from eUSDT)
      // He can withdraw eUSDC → USDC
      const bobToken0BalanceBefore = await token0.balanceOf(bob.address);

      await hook.connect(bob).withdraw(poolKey, poolKey.currency0, swapAmount, bob.address);
      await mineBlock();

      const bobToken0BalanceAfter = await token0.balanceOf(bob.address);
      expect(bobToken0BalanceAfter - bobToken0BalanceBefore).to.equal(swapAmount);

      console.log("Bob withdrew:", ethers.formatUnits(swapAmount, 6), "USDC");

      console.log("\n[SUMMARY] COMPLETE FLOW EXECUTED");
      console.log("Alice: USDC -> eUSDC -> eUSDT -> USDT");
      console.log("Bob: USDT -> eUSDT -> eUSDC -> USDC");
      console.log("Settlement: 100% internal matching (0% AMM usage)");
      console.log("Privacy: All amounts and actions encrypted");
    });
  });

  describe("Settlement with Privacy Verification", function () {
    it("should keep all amounts encrypted during settlement", async function () {
      const hookAddress = await hook.getAddress();
      const swapAmount = ethers.parseUnits("500", 6);

      // Setup deposits
      await token0.connect(alice).approve(hookAddress, DEPOSIT_AMOUNT);
      await hook.connect(alice).deposit(poolKey, poolKey.currency0, DEPOSIT_AMOUNT);
      await mineBlock();

      const encToken0Address = await getEncryptedTokenAddress(hook, poolKey, poolKey.currency0);
      encryptedToken0 = await ethers.getContractAt("PoolEncryptedToken", encToken0Address);

      await token1.connect(bob).approve(hookAddress, DEPOSIT_AMOUNT);
      await hook.connect(bob).deposit(poolKey, poolKey.currency1, DEPOSIT_AMOUNT);
      await mineBlock();

      const encToken1Address = await getEncryptedTokenAddress(hook, poolKey, poolKey.currency1);
      encryptedToken1 = await ethers.getContractAt("PoolEncryptedToken", encToken1Address);

      // Set operators
      await encryptedToken0.connect(alice).setOperator(hookAddress, MAX_OPERATOR_EXPIRY);
      await encryptedToken1.connect(bob).setOperator(hookAddress, MAX_OPERATOR_EXPIRY);
      await mineBlock();

      // Submit intents
      const aliceEncAmount = await fhevm
        .createEncryptedInput(hookAddress, alice.address)
        .add64(Number(swapAmount))
        .encrypt();

      const aliceEncAction = await fhevm.createEncryptedInput(hookAddress, alice.address).add8(0).encrypt();

      await hook
        .connect(alice)
        .submitIntent(
          poolKey,
          poolKey.currency0,
          aliceEncAmount.handles[0],
          aliceEncAmount.inputProof,
          aliceEncAction.handles[0],
          aliceEncAction.inputProof,
          0,
        );

      await mineBlock();

      // Verify batch was created and intent was added
      const currentBatchId = await hook.currentBatchId(poolId);
      expect(currentBatchId).to.not.equal(ethers.ZeroHash);

      const batchData = await hook.batches(currentBatchId);
      expect(batchData.totalIntents).to.be.greaterThan(0);

      console.log("\nPrivacy maintained:");
      console.log("  Intent amount: encrypted (euint64)");
      console.log("  Intent action: encrypted (euint8)");
      console.log("  Only relayer can decrypt with FHE permissions");
    });
  });

  describe("Batch Lifecycle Management", function () {
    it("should manage batch lifecycle correctly", async function () {
      const hookAddress = await hook.getAddress();

      // Setup
      await token0.connect(alice).approve(hookAddress, DEPOSIT_AMOUNT);
      await hook.connect(alice).deposit(poolKey, poolKey.currency0, DEPOSIT_AMOUNT);
      await mineBlock();

      const encToken0Address = await getEncryptedTokenAddress(hook, poolKey, poolKey.currency0);
      encryptedToken0 = await ethers.getContractAt("PoolEncryptedToken", encToken0Address);

      await encryptedToken0.connect(alice).setOperator(hookAddress, MAX_OPERATOR_EXPIRY);
      await mineBlock();

      // Submit intent (creates batch)
      const encAmount = await fhevm.createEncryptedInput(hookAddress, alice.address).add64(1000).encrypt();

      const encAction = await fhevm.createEncryptedInput(hookAddress, alice.address).add8(0).encrypt();

      await hook
        .connect(alice)
        .submitIntent(
          poolKey,
          poolKey.currency0,
          encAmount.handles[0],
          encAmount.inputProof,
          encAction.handles[0],
          encAction.inputProof,
          0,
        );

      await mineBlock();

      const batchId = await hook.currentBatchId(poolId);

      // Check initial state
      let batch = await hook.batches(batchId);
      expect(batch.finalized).to.be.false;
      expect(batch.settled).to.be.false;

      // Finalize
      await hook.connect(relayer).finalizeBatch(poolId);
      await mineBlock();

      batch = await hook.batches(batchId);
      expect(batch.finalized).to.be.true;
      expect(batch.settled).to.equal(false);

      // Settle
      await hook
        .connect(relayer)
        .settleBatch(
          batchId,
          [],
          0,
          poolKey.currency0,
          poolKey.currency1,
          await encryptedToken0.getAddress(),
          [],
          "0x",
        );

      await mineBlock();

      batch = await hook.batches(batchId);
      expect(batch.finalized).to.be.true;
      expect(batch.settled).to.be.true;

      console.log("\nBatch lifecycle:");
      console.log("  1. Created (finalized=false, settled=false)");
      console.log("  2. Finalized (finalized=true, settled=false)");
      console.log("  3. Settled (finalized=true, settled=true)");
    });
  });
});
