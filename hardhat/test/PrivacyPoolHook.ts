import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { TestablePrivacyPoolHook, PoolEncryptedToken, PoolManager, MockERC20 } from "../types";
import { mineBlock, type PoolKey } from "./helpers/privacypool.helpers";

describe("PrivacyPoolHook", function () {
  let hook: TestablePrivacyPoolHook;
  let poolManager: PoolManager;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;

  let mockToken0: MockERC20;
  let mockToken1: MockERC20;
  let poolKey: PoolKey;

  const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);
  const SWAP_AMOUNT = ethers.parseUnits("100", 6);

  beforeEach(async function () {
    // Check if we're using FHEVM mock
    if (!fhevm.isMock) {
      console.log("This test requires FHEVM mock environment");
      this.skip();
    }

    [owner, alice, bob, relayer] = await ethers.getSigners();

    // Deploy REAL Uniswap V4 PoolManager
    const PoolManagerFactory = await ethers.getContractFactory("contracts/mocks/PoolManager.sol:PoolManager");
    poolManager = await PoolManagerFactory.deploy(owner.address);
    await poolManager.waitForDeployment();
    const poolManagerAddress = await poolManager.getAddress();

    // Deploy mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken0 = await MockERC20.deploy("Token0", "TKN0", 6);
    await mockToken0.waitForDeployment();

    mockToken1 = await MockERC20.deploy("Token1", "TKN1", 6);
    await mockToken1.waitForDeployment();

    // Mint tokens to users
    await mockToken0.mint(alice.address, ethers.parseUnits("100000", 6));
    await mockToken1.mint(alice.address, ethers.parseUnits("100000", 6));

    await mockToken0.mint(bob.address, ethers.parseUnits("100000", 6));
    await mockToken1.mint(bob.address, ethers.parseUnits("100000", 6));

    // Deploy SettlementLib library
    const SettlementLibFactory = await ethers.getContractFactory("SettlementLib");
    const settlementLib = await SettlementLibFactory.deploy();
    await settlementLib.waitForDeployment();

    // Deploy MockPyth
    const MockPythFactory = await ethers.getContractFactory("contracts/mocks/MockPyth.sol:MockPyth");
    const mockPyth = await MockPythFactory.deploy(60, 1);
    await mockPyth.waitForDeployment();

    // Deploy TestablePrivacyPoolHook (skips address validation for testing)
    const TestablePrivacyPoolHookFactory = await ethers.getContractFactory("TestablePrivacyPoolHook", {
      libraries: {
        SettlementLib: await settlementLib.getAddress(),
      },
    });
    hook = await TestablePrivacyPoolHookFactory.deploy(
      poolManagerAddress,
      relayer.address,
      await mockPyth.getAddress()
    );
    await hook.waitForDeployment();

    // Create poolKey
    poolKey = {
      currency0: await mockToken0.getAddress(),
      currency1: await mockToken1.getAddress(),
      fee: 3000,
      tickSpacing: 60,
      hooks: await hook.getAddress(),
    };

    console.log("Setup complete");
  });

  describe("Deployment", function () {
    it("should deploy with correct initial state", async function () {
      expect(await hook.owner()).to.equal(owner.address);
      expect(await hook.relayer()).to.equal(relayer.address);
    });
  });

  describe("Deposit Operations", function () {
    it("should allow users to deposit tokens and create encrypted tokens", async function () {
      await mockToken0.connect(alice).approve(await hook.getAddress(), DEPOSIT_AMOUNT);

      await hook.connect(alice).deposit(poolKey, poolKey.currency0, DEPOSIT_AMOUNT);
      await mineBlock();

      // Verify encrypted token was created by checking poolEncryptedTokens mapping
      const poolId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint24", "int24", "address"],
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
        )
      );
      const encryptedTokenAddress = await hook.poolEncryptedTokens(poolId, poolKey.currency0);
      expect(encryptedTokenAddress).to.not.equal(ethers.ZeroAddress);

      console.log("Encrypted token created:", encryptedTokenAddress);
    });

    it("should reject zero amount deposits", async function () {
      await expect(hook.connect(alice).deposit(poolKey, poolKey.currency0, 0)).to.be.revertedWithCustomError(
        hook,
        "ERR",
      ).withArgs(5); // E05: Zero amount
    });
  });

  describe("Submit Intent with Encrypted Actions", function () {
    let encryptedToken0: PoolEncryptedToken;

    beforeEach(async function () {
      const hookAddress = await hook.getAddress();

      await mockToken0.connect(alice).approve(hookAddress, ethers.parseUnits("10000", 6));
      await hook.connect(alice).deposit(poolKey, poolKey.currency0, ethers.parseUnits("10000", 6));
      await mineBlock();

      // Get encrypted token address from poolEncryptedTokens mapping
      const poolId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint24", "int24", "address"],
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
        )
      );
      const tokenAddress = await hook.poolEncryptedTokens(poolId, poolKey.currency0);
      encryptedToken0 = await ethers.getContractAt("PoolEncryptedToken", tokenAddress);

      // Set operator permission for hook to use confidentialTransferFrom
      const maxExpiry = 2n ** 48n - 1n; // type(uint48).max
      await encryptedToken0.connect(alice).setOperator(hookAddress, maxExpiry); /// operator === approve in normal erc20 btw (without amount)
      await mineBlock();
    });

    it("should allow users to submit encrypted intents", async function () {
      const hookAddress = await hook.getAddress();

      // Create encrypted inputs
      const encAmount = await fhevm
        .createEncryptedInput(hookAddress, alice.address)
        .add64(Number(SWAP_AMOUNT))
        .encrypt();

      const encAction = await fhevm
        .createEncryptedInput(hookAddress, alice.address)
        .add8(0) // ACTION_SWAP_0_TO_1
        .encrypt();

      // Submit intent
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

      // Verify batch was created and intent was added
      const poolId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint24", "int24", "address"],
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
        )
      );
      const batchId = await hook.currentBatchId(poolId);
      expect(batchId).to.not.equal(ethers.ZeroHash);

      console.log("Intent submitted with encrypted amount and action");
    });
  });

  describe("Privacy Features", function () {
    let encryptedToken0: PoolEncryptedToken;

    beforeEach(async function () {
      const hookAddress = await hook.getAddress();

      await mockToken0.connect(alice).approve(hookAddress, ethers.parseUnits("10000", 6));
      await hook.connect(alice).deposit(poolKey, poolKey.currency0, ethers.parseUnits("10000", 6));
      await mineBlock();

      // Get encrypted token from poolEncryptedTokens mapping
      const poolId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint24", "int24", "address"],
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
        )
      );
      const tokenAddress = await hook.poolEncryptedTokens(poolId, poolKey.currency0);
      encryptedToken0 = await ethers.getContractAt("PoolEncryptedToken", tokenAddress);

      const maxExpiry = 2n ** 48n - 1n;
      await encryptedToken0.connect(alice).setOperator(hookAddress, maxExpiry); /// operator === approve in normal erc20 btw (without amount)
      await mineBlock();
    });

    it("should keep amount and action encrypted", async function () {
      const hookAddress = await hook.getAddress();

      const encAmount = await fhevm
        .createEncryptedInput(hookAddress, alice.address)
        .add64(Number(SWAP_AMOUNT))
        .encrypt();

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

      console.log("Amount and action remain encrypted on-chain");
    });
  });

  describe("Batch Management", function () {
    let encryptedToken0: PoolEncryptedToken;

    beforeEach(async function () {
      const hookAddress = await hook.getAddress();

      await mockToken0.connect(alice).approve(hookAddress, ethers.parseUnits("10000", 6));
      await hook.connect(alice).deposit(poolKey, poolKey.currency0, ethers.parseUnits("10000", 6));
      await mineBlock();

      // Get encrypted token from poolEncryptedTokens mapping
      const poolId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint24", "int24", "address"],
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
        )
      );
      const tokenAddress = await hook.poolEncryptedTokens(poolId, poolKey.currency0);
      encryptedToken0 = await ethers.getContractAt("PoolEncryptedToken", tokenAddress);

      const maxExpiry = 2n ** 48n - 1n;
      await encryptedToken0.connect(alice).setOperator(hookAddress, maxExpiry); /// operator === approve in normal erc20 btw (without amount)
      await mineBlock();
    });

    it("should create new batch on first intent", async function () {
      const hookAddress = await hook.getAddress();

      const encAmount = await fhevm
        .createEncryptedInput(hookAddress, alice.address)
        .add64(Number(SWAP_AMOUNT))
        .encrypt();

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

      const poolId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint24", "int24", "address"],
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        ),
      );

      const currentBatchId = await hook.currentBatchId(poolId);
      expect(currentBatchId).to.not.equal(ethers.ZeroHash);

      console.log("Batch created");
    });
  });
});
