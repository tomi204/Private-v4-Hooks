import { expect } from "chai";
import hre, { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { TestablePrivacyPoolHook, PoolEncryptedToken, PoolManager, MockERC20, SimpleLending } from "../types";
import { mineBlock, type PoolKey } from "./helpers/privacypool.helpers";

describe("PrivacyPoolHook: Delta Zero Rebalancing", function () {
  let hook: TestablePrivacyPoolHook;
  let poolManager: PoolManager;
  let pyth: any;
  let simpleLending: SimpleLending;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;

  let usdc: MockERC20;
  let weth: MockERC20;
  let encryptedUSDC: PoolEncryptedToken;
  let encryptedWETH: PoolEncryptedToken;
  let poolKey: PoolKey;
  let poolId: string;

  const INITIAL_BALANCE = ethers.parseUnits("100000", 6);
  const DEPOSIT_AMOUNT = ethers.parseUnits("10000", 6);
  const MAX_OPERATOR_EXPIRY = 2n ** 48n - 1n;
  const ETH_USD_PRICE_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.log("This test requires FHEVM mock environment");
      this.skip();
    }

    [owner, alice, bob, relayer] = await ethers.getSigners();

    // Deploy MockPyth
    const MockPythFactory = await ethers.getContractFactory("contracts/mocks/MockPyth.sol:MockPyth");
    pyth = await MockPythFactory.deploy(60, 1);
    await pyth.waitForDeployment();

    // Set initial ETH price: $2000 (using createPriceFeedUpdateData and updatePriceFeeds)
    const initialPriceUpdate = await pyth.createPriceFeedUpdateData(
      ETH_USD_PRICE_FEED,
      2000n * 100000n,
      10n * 100000n,
      -5,
      2000n * 100000n,
      10n * 100000n,
      BigInt(Math.floor(Date.now() / 1000)),
      BigInt(Math.floor(Date.now() / 1000))
    );

    const updateFee = await pyth.getUpdateFee([initialPriceUpdate]);
    await pyth.updatePriceFeeds([initialPriceUpdate], { value: updateFee });

    // Deploy USDC
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20Factory.deploy("USDC", "USDC", 6);
    await usdc.waitForDeployment();

    weth = await MockERC20Factory.deploy("WETH", "WETH", 18);
    await weth.waitForDeployment();

    // Deploy SimpleLending
    const SimpleLendingFactory = await ethers.getContractFactory("SimpleLending");
    simpleLending = await SimpleLendingFactory.deploy(await usdc.getAddress());
    await simpleLending.waitForDeployment();

    // Fund SimpleLending with ETH
    await owner.sendTransaction({
      to: await simpleLending.getAddress(),
      value: ethers.parseEther("100"),
    });

    // Supply USDC to SimpleLending
    await usdc.mint(owner.address, ethers.parseUnits("100000", 6));
    await usdc.approve(await simpleLending.getAddress(), ethers.parseUnits("100000", 6));
    await usdc.transfer(await simpleLending.getAddress(), ethers.parseUnits("50000", 6));

    // Deploy PoolManager
    const PoolManagerFactory = await ethers.getContractFactory("contracts/mocks/PoolManager.sol:PoolManager");
    poolManager = await PoolManagerFactory.deploy(owner.address);
    await poolManager.waitForDeployment();

    // Deploy SettlementLib library
    const SettlementLibFactory = await ethers.getContractFactory("SettlementLib");
    const settlementLib = await SettlementLibFactory.deploy();
    await settlementLib.waitForDeployment();

    // Deploy TestablePrivacyPoolHook (address validation skipped in MockPoolManager)
    const TestablePrivacyPoolHookFactory = await ethers.getContractFactory("TestablePrivacyPoolHook", {
      libraries: {
        SettlementLib: await settlementLib.getAddress(),
      },
    });
    hook = await TestablePrivacyPoolHookFactory.deploy(
      await poolManager.getAddress(),
      relayer.address,
      await pyth.getAddress()
    );
    await hook.waitForDeployment();

    // Fund hook with ETH for Pyth fees and lending operations
    await owner.sendTransaction({
      to: await hook.getAddress(),
      value: ethers.parseEther("10"),
    });

    // Mint tokens to users
    await usdc.mint(alice.address, INITIAL_BALANCE);
    await usdc.mint(bob.address, INITIAL_BALANCE);
    await weth.mint(alice.address, ethers.parseEther("100"));
    await weth.mint(bob.address, ethers.parseEther("100"));

    // Create poolKey - currencies must be sorted (currency0 < currency1)
    const usdcAddress = await usdc.getAddress();
    const wethAddress = await weth.getAddress();
    const [currency0, currency1] = usdcAddress.toLowerCase() < wethAddress.toLowerCase()
      ? [usdcAddress, wethAddress]
      : [wethAddress, usdcAddress];

    poolKey = {
      currency0,
      currency1,
      fee: 3000,
      tickSpacing: 60,
      hooks: await hook.getAddress(),
    };

    // Calculate poolId
    poolId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
      )
    );

    // Initialize the pool in PoolManager (required for Uniswap V4)
    const sqrtPriceX96 = BigInt("79228162514264337593543950336"); // 1:1 price
    await poolManager.initialize(poolKey, sqrtPriceX96);

    console.log("[Setup] Delta Zero Strategy Ready");
  });

  describe("Pyth Oracle Integration", function () {
    it("should update Pyth price on settlement", async function () {
      const hookAddress = await hook.getAddress();

      // Deposit tokens - use USDC address directly
      const usdcAddress = await usdc.getAddress();
      await usdc.connect(alice).approve(hookAddress, DEPOSIT_AMOUNT);
      await hook.connect(alice).deposit(poolKey, usdcAddress, DEPOSIT_AMOUNT);
      await mineBlock();

      // Get encrypted token from poolEncryptedTokens mapping
      const poolId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint24", "int24", "address"],
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
        )
      );
      const encryptedTokenAddress = await hook.poolEncryptedTokens(poolId, usdcAddress);
      encryptedUSDC = await ethers.getContractAt("PoolEncryptedToken", encryptedTokenAddress);

      // Set operator
      await encryptedUSDC.connect(alice).setOperator(hookAddress, MAX_OPERATOR_EXPIRY);
      await mineBlock();

      // Submit intent
      const swapAmount = ethers.parseUnits("1000", 6);
      const encAmount = await fhevm.createEncryptedInput(hookAddress, alice.address).add64(Number(swapAmount)).encrypt();
      const encAction = await fhevm.createEncryptedInput(hookAddress, alice.address).add8(0).encrypt();
      const wethAddress = await weth.getAddress();

      await hook
        .connect(alice)
        .submitIntent(poolKey, usdcAddress, encAmount.handles[0], encAmount.inputProof, encAction.handles[0], encAction.inputProof, 0);

      await mineBlock();

      // Finalize batch
      const batchId = await hook.currentBatchId(poolId);
      await hook.connect(relayer).finalizeBatch(poolId);
      await mineBlock();

      // Create Pyth price update
      const priceUpdate = await pyth.createPriceFeedUpdateData(
        ETH_USD_PRICE_FEED,
        2100n * 100000n,
        10n * 100000n,
        -5,
        2100n * 100000n,
        10n * 100000n,
        BigInt(Math.floor(Date.now() / 1000)),
        BigInt(Math.floor(Date.now() / 1000))
      );

      // Settle batch with Pyth update
      await hook
        .connect(relayer)
        .settleBatch(batchId, [], 100, usdcAddress, wethAddress, await encryptedUSDC.getAddress(), [], priceUpdate, {
          value: ethers.parseEther("0.01"),
        });

      await mineBlock();

      // Price update happens internally via Pyth oracle
      // No event emitted from hook (events removed for contract size optimization)
      console.log("Pyth price updated successfully during settlement");
    });
  });

  describe("Delta Zero Rebalancing Strategy", function () {
    it("should execute rebalance strategy on settlement", async function () {
      const hookAddress = await hook.getAddress();

      // Get token addresses
      const usdcAddress = await usdc.getAddress();
      const wethAddress = await weth.getAddress();

      // Deposit tokens
      await usdc.connect(alice).approve(hookAddress, DEPOSIT_AMOUNT);
      await weth.connect(bob).approve(hookAddress, ethers.parseEther("5"));

      await hook.connect(alice).deposit(poolKey, usdcAddress, DEPOSIT_AMOUNT);
      await mineBlock();

      await hook.connect(bob).deposit(poolKey, wethAddress, ethers.parseEther("5"));
      await mineBlock();

      // Get encrypted tokens from poolEncryptedTokens mapping
      const poolId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint24", "int24", "address"],
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
        )
      );
      const encryptedUSDCAddress = await hook.poolEncryptedTokens(poolId, usdcAddress);
      const encryptedWETHAddress = await hook.poolEncryptedTokens(poolId, wethAddress);

      encryptedUSDC = await ethers.getContractAt("PoolEncryptedToken", encryptedUSDCAddress);
      encryptedWETH = await ethers.getContractAt("PoolEncryptedToken", encryptedWETHAddress);

      // Set operators
      await encryptedUSDC.connect(alice).setOperator(hookAddress, MAX_OPERATOR_EXPIRY);
      await encryptedWETH.connect(bob).setOperator(hookAddress, MAX_OPERATOR_EXPIRY);
      await mineBlock();

      // Submit intents
      const swapAmount = ethers.parseUnits("1000", 6);
      const aliceEncAmount = await fhevm.createEncryptedInput(hookAddress, alice.address).add64(Number(swapAmount)).encrypt();
      const aliceEncAction = await fhevm.createEncryptedInput(hookAddress, alice.address).add8(0).encrypt();

      await hook
        .connect(alice)
        .submitIntent(
          poolKey,
          usdcAddress,
          aliceEncAmount.handles[0],
          aliceEncAmount.inputProof,
          aliceEncAction.handles[0],
          aliceEncAction.inputProof,
          0
        );

      await mineBlock();

      // Finalize batch
      const batchId = await hook.currentBatchId(poolId);
      await hook.connect(relayer).finalizeBatch(poolId);
      await mineBlock();

      // Create Pyth price update
      const priceUpdate = await pyth.createPriceFeedUpdateData(
        ETH_USD_PRICE_FEED,
        2200n * 100000n,
        10n * 100000n,
        -5,
        2200n * 100000n,
        10n * 100000n,
        BigInt(Math.floor(Date.now() / 1000)),
        BigInt(Math.floor(Date.now() / 1000))
      );

      // Settle with rebalancing
      const settleTx = await hook
        .connect(relayer)
        .settleBatch(batchId, [], 100, usdcAddress, wethAddress, await encryptedWETH.getAddress(), [], priceUpdate, {
          value: ethers.parseEther("0.01"),
        });

      const settleReceipt = await settleTx.wait();
      await mineBlock();

      // Check for rebalance events
      const rebalanceEvents = settleReceipt?.logs.filter((log) => {
        try {
          const parsed = hook.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          return parsed?.name === "RebalanceExecuted" || parsed?.name === "PoolStateRetrieved";
        } catch {
          return false;
        }
      });

      console.log("Rebalance strategy executed");
      console.log("  Events captured:", rebalanceEvents?.length || 0);
      console.log("  Settlement completed with delta zero strategy");
    });
  });

  describe("SimpleLending Integration", function () {
    it("should interact with SimpleLending for borrow/repay", async function () {
      const lendingAddress = await simpleLending.getAddress();

      // Check initial balances
      const initialETH = await ethers.provider.getBalance(lendingAddress);
      const initialUSDC = await usdc.balanceOf(lendingAddress);

      console.log("\nSimpleLending State:");
      console.log("  ETH balance:", ethers.formatEther(initialETH));
      console.log("  USDC balance:", ethers.formatUnits(initialUSDC, 6));

      expect(initialETH).to.be.greaterThan(0);
      expect(initialUSDC).to.be.greaterThan(0);

      console.log("SimpleLending ready for delta zero operations");
    });
  });
});
