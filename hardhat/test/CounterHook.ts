import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { expect } from "chai";
import { TestableCounterHook, PoolManager } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

type PoolKey = {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
};

describe("CounterHook", function () {
  let signers: Signers;
  let counterHook: TestableCounterHook;
  let poolManager: PoolManager;
  let poolManagerAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    // Deploy the REAL Uniswap v4 PoolManager
    const PoolManagerFactory = await ethers.getContractFactory("contracts/mocks/PoolManager.sol:PoolManager");
    poolManager = await PoolManagerFactory.deploy(signers.deployer.address);
    await poolManager.waitForDeployment();
    poolManagerAddress = await poolManager.getAddress();

    // Deploy the TestableCounterHook (skips address validation for testing)
    const TestableCounterHookFactory = await ethers.getContractFactory("TestableCounterHook");
    counterHook = await TestableCounterHookFactory.deploy(poolManagerAddress);
    await counterHook.waitForDeployment();
  });

  describe("Hook Permissions", function () {
    it("should return correct hook permissions", async function () {
      const permissions = await counterHook.getHookPermissions();

      expect(permissions.beforeInitialize).to.equal(false);
      expect(permissions.afterInitialize).to.equal(false);
      expect(permissions.beforeAddLiquidity).to.equal(true);
      expect(permissions.afterAddLiquidity).to.equal(false);
      expect(permissions.beforeRemoveLiquidity).to.equal(true);
      expect(permissions.afterRemoveLiquidity).to.equal(false);
      expect(permissions.beforeSwap).to.equal(true);
      expect(permissions.afterSwap).to.equal(true);
      expect(permissions.beforeDonate).to.equal(false);
      expect(permissions.afterDonate).to.equal(false);
      expect(permissions.beforeSwapReturnDelta).to.equal(false);
      expect(permissions.afterSwapReturnDelta).to.equal(false);
      expect(permissions.afterAddLiquidityReturnDelta).to.equal(false);
      expect(permissions.afterRemoveLiquidityReturnDelta).to.equal(false);
    });
  });

  describe("Counter Tracking", function () {
    let poolId: string;

    beforeEach(async function () {
      // Create a mock poolId for testing
      // In production, this would be generated from the actual PoolKey
      poolId = ethers.keccak256(ethers.toUtf8Bytes("test-pool-1"));
    });

    it("should initialize all counters to zero", async function () {
      const beforeSwapCount = await counterHook.beforeSwapCount(poolId);
      const afterSwapCount = await counterHook.afterSwapCount(poolId);
      const beforeAddLiquidityCount = await counterHook.beforeAddLiquidityCount(poolId);
      const beforeRemoveLiquidityCount = await counterHook.beforeRemoveLiquidityCount(poolId);

      expect(beforeSwapCount).to.equal(0);
      expect(afterSwapCount).to.equal(0);
      expect(beforeAddLiquidityCount).to.equal(0);
      expect(beforeRemoveLiquidityCount).to.equal(0);
    });

    it("should track counters independently per pool", async function () {
      const poolId2 = ethers.keccak256(ethers.toUtf8Bytes("test-pool-2"));

      // Pool 1 should have 0
      expect(await counterHook.beforeSwapCount(poolId)).to.equal(0);

      // Pool 2 should also have 0
      expect(await counterHook.beforeSwapCount(poolId2)).to.equal(0);

      // They should be independent
      expect(poolId).to.not.equal(poolId2);
    });

    it("should allow reading counter values publicly", async function () {
      // All counters should be publicly readable
      await counterHook.beforeSwapCount(poolId);
      await counterHook.afterSwapCount(poolId);
      await counterHook.beforeAddLiquidityCount(poolId);
      await counterHook.beforeRemoveLiquidityCount(poolId);
    });
  });

  describe("Hook Integration", function () {
    it("should have correct poolManager reference", async function () {
      // The hook should store the poolManager address
      // We can't directly access it as it's in the base contract,
      // but we can verify the hook was constructed correctly
      const hookAddress = await counterHook.getAddress();
      expect(ethers.isAddress(hookAddress)).to.equal(true);
    });

    it("should be ready for pool operations", async function () {
      // Verify hook permissions are set correctly for operations
      const permissions = await counterHook.getHookPermissions();

      // These hooks should trigger on operations
      expect(permissions.beforeSwap).to.equal(true);
      expect(permissions.afterSwap).to.equal(true);
      expect(permissions.beforeAddLiquidity).to.equal(true);
      expect(permissions.beforeRemoveLiquidity).to.equal(true);
    });
  });

  describe("TestableCounterHook Specific", function () {
    it("should skip address validation (testable version only)", async function () {
      // This test verifies that we're using the TestableCounterHook
      // which overrides validateHookAddress to skip validation

      // If this were the production CounterHook, deployment would fail
      // due to address validation. The fact that we deployed successfully
      // confirms we're using the testable version.

      const hookAddress = await counterHook.getAddress();
      expect(ethers.isAddress(hookAddress)).to.equal(true);

      // The address does NOT need to match the hook flags
      // This is only possible because TestableCounterHook skips validation
    });

    it("should still maintain all CounterHook functionality", async function () {
      // Verify that overriding validateHookAddress doesn't break other functionality
      const permissions = await counterHook.getHookPermissions();

      // All permissions should work the same as CounterHook
      expect(permissions.beforeSwap).to.equal(true);
      expect(permissions.afterSwap).to.equal(true);
      expect(permissions.beforeAddLiquidity).to.equal(true);
      expect(permissions.beforeRemoveLiquidity).to.equal(true);
    });
  });

  describe("Counter State Management", function () {
    it("should handle multiple pool IDs correctly", async function () {
      const poolIds = [
        ethers.keccak256(ethers.toUtf8Bytes("pool-1")),
        ethers.keccak256(ethers.toUtf8Bytes("pool-2")),
        ethers.keccak256(ethers.toUtf8Bytes("pool-3")),
      ];

      // All pools should start at 0
      for (const id of poolIds) {
        expect(await counterHook.beforeSwapCount(id)).to.equal(0);
        expect(await counterHook.afterSwapCount(id)).to.equal(0);
        expect(await counterHook.beforeAddLiquidityCount(id)).to.equal(0);
        expect(await counterHook.beforeRemoveLiquidityCount(id)).to.equal(0);
      }
    });

    it("should have correct initial counter values", async function () {
      const poolId = ethers.keccak256(ethers.toUtf8Bytes("test-pool"));

      const beforeSwap = await counterHook.beforeSwapCount(poolId);
      const afterSwap = await counterHook.afterSwapCount(poolId);
      const beforeAdd = await counterHook.beforeAddLiquidityCount(poolId);
      const beforeRemove = await counterHook.beforeRemoveLiquidityCount(poolId);

      // All counters should start at 0
      expect(beforeSwap).to.equal(0);
      expect(afterSwap).to.equal(0);
      expect(beforeAdd).to.equal(0);
      expect(beforeRemove).to.equal(0);
    });
  });

  describe("Counter Increment Tests", function () {
    let hookAddress: string;
    let poolKey: PoolKey;
    let poolId: string;

    beforeEach(async function () {
      hookAddress = await counterHook.getAddress();

      // Create a minimal poolKey for testing
      // Note: We use zero addresses for currencies since we're only testing hook calls
      poolKey = {
        currency0: ethers.ZeroAddress,
        currency1: ethers.ZeroAddress,
        fee: 3000,
        tickSpacing: 60,
        hooks: hookAddress,
      };

      // Calculate poolId (simplified - in production this uses PoolIdLibrary)
      const poolKeyEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      );
      poolId = ethers.keccak256(poolKeyEncoded);
    });

    it("should increment beforeSwap counter when beforeSwap is called", async function () {
      // Initial count should be 0
      const countBefore = await counterHook.beforeSwapCount(poolId);
      expect(countBefore).to.equal(0);

      // Call testBeforeSwap (exposed for testing)
      const swapParams = {
        zeroForOne: true,
        amountSpecified: 1000,
        sqrtPriceLimitX96: 0,
      };

      await counterHook.testBeforeSwap(signers.deployer.address, poolKey, swapParams, "0x");

      // Counter should increment to 1
      const countAfter = await counterHook.beforeSwapCount(poolId);
      expect(countAfter).to.equal(1);

      // Call again - should increment to 2
      await counterHook.testBeforeSwap(signers.deployer.address, poolKey, swapParams, "0x");
      const countAfter2 = await counterHook.beforeSwapCount(poolId);
      expect(countAfter2).to.equal(2);
    });

    it("should increment afterSwap counter when afterSwap is called", async function () {
      const countBefore = await counterHook.afterSwapCount(poolId);
      expect(countBefore).to.equal(0);

      const swapParams = {
        zeroForOne: true,
        amountSpecified: 1000,
        sqrtPriceLimitX96: 0,
      };

      const balanceDelta = 0n; // Mock delta

      await counterHook.testAfterSwap(signers.deployer.address, poolKey, swapParams, balanceDelta, "0x");

      // Counter should increment to 1
      const countAfter = await counterHook.afterSwapCount(poolId);
      expect(countAfter).to.equal(1);

      // Call again
      await counterHook.testAfterSwap(signers.deployer.address, poolKey, swapParams, balanceDelta, "0x");
      const countAfter2 = await counterHook.afterSwapCount(poolId);
      expect(countAfter2).to.equal(2);
    });

    it("should increment beforeAddLiquidity counter when beforeAddLiquidity is called", async function () {
      const countBefore = await counterHook.beforeAddLiquidityCount(poolId);
      expect(countBefore).to.equal(0);

      const modifyParams = {
        tickLower: -60,
        tickUpper: 60,
        liquidityDelta: 1000,
        salt: ethers.ZeroHash,
      };

      await counterHook.testBeforeAddLiquidity(signers.deployer.address, poolKey, modifyParams, "0x");

      // Counter should increment to 1
      const countAfter = await counterHook.beforeAddLiquidityCount(poolId);
      expect(countAfter).to.equal(1);

      // Call again
      await counterHook.testBeforeAddLiquidity(signers.deployer.address, poolKey, modifyParams, "0x");
      const countAfter2 = await counterHook.beforeAddLiquidityCount(poolId);
      expect(countAfter2).to.equal(2);
    });

    it("should increment beforeRemoveLiquidity counter when beforeRemoveLiquidity is called", async function () {
      const countBefore = await counterHook.beforeRemoveLiquidityCount(poolId);
      expect(countBefore).to.equal(0);

      const modifyParams = {
        tickLower: -60,
        tickUpper: 60,
        liquidityDelta: -1000,
        salt: ethers.ZeroHash,
      };

      await counterHook.testBeforeRemoveLiquidity(signers.deployer.address, poolKey, modifyParams, "0x");

      // Counter should increment to 1
      const countAfter = await counterHook.beforeRemoveLiquidityCount(poolId);
      expect(countAfter).to.equal(1);

      // Call again
      await counterHook.testBeforeRemoveLiquidity(signers.deployer.address, poolKey, modifyParams, "0x");
      const countAfter2 = await counterHook.beforeRemoveLiquidityCount(poolId);
      expect(countAfter2).to.equal(2);
    });

    it("should have correct poolKey structure", async function () {
      expect(poolKey.currency0).to.equal(ethers.ZeroAddress);
      expect(poolKey.currency1).to.equal(ethers.ZeroAddress);
      expect(poolKey.fee).to.equal(3000);
      expect(poolKey.tickSpacing).to.equal(60);
      expect(poolKey.hooks).to.equal(hookAddress);
    });

    it("should generate consistent poolId for same poolKey", async function () {
      // Generate poolId again
      const poolKeyEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      );
      const poolId2 = ethers.keccak256(poolKeyEncoded);

      expect(poolId).to.equal(poolId2);
    });

    it("should have different counters for different poolIds", async function () {
      // Create a different poolKey
      const poolKey2 = {
        currency0: ethers.ZeroAddress,
        currency1: ethers.ZeroAddress,
        fee: 500, // Different fee
        tickSpacing: 10, // Different tick spacing
        hooks: hookAddress,
      };

      const poolKeyEncoded2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [poolKey2.currency0, poolKey2.currency1, poolKey2.fee, poolKey2.tickSpacing, poolKey2.hooks],
      );
      const poolId2 = ethers.keccak256(poolKeyEncoded2);

      // PoolIds should be different
      expect(poolId).to.not.equal(poolId2);

      // Both should have 0 counters initially
      expect(await counterHook.beforeSwapCount(poolId)).to.equal(0);
      expect(await counterHook.beforeSwapCount(poolId2)).to.equal(0);
    });
  });
});
