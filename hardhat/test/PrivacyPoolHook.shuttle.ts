import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { TestablePrivacyPoolHook, PoolManager, MockERC20, SimpleLending } from "../types";

describe("PrivacyPoolHook: Liquidity Shuttle", function () {
  let hook: TestablePrivacyPoolHook;
  let poolManager: PoolManager;
  let simpleLending: SimpleLending;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;

  let usdc: MockERC20;
  let weth: MockERC20;
  let poolKey: any;

  const INITIAL_BALANCE = ethers.parseUnits("100000", 6);
  const LIQUIDITY_SOURCE_BALANCE = ethers.parseUnits("50000", 6);
  const SWAP_AMOUNT = ethers.parseUnits("1000", 6);

  beforeEach(async function () {
    [owner, alice, bob, relayer] = await ethers.getSigners();

    // Deploy SettlementLib library
    const SettlementLibFactory = await ethers.getContractFactory("SettlementLib");
    const settlementLib = await SettlementLibFactory.deploy();
    await settlementLib.waitForDeployment();

    // Deploy MockPyth
    const MockPythFactory = await ethers.getContractFactory("contracts/mocks/MockPyth.sol:MockPyth");
    const pyth = await MockPythFactory.deploy(60, 1);
    await pyth.waitForDeployment();

    // Deploy USDC & WETH
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20Factory.deploy("USDC", "USDC", 6);
    await usdc.waitForDeployment();

    weth = await MockERC20Factory.deploy("WETH", "WETH", 18);
    await weth.waitForDeployment();

    // Deploy PoolManager
    const PoolManagerFactory = await ethers.getContractFactory("contracts/mocks/PoolManager.sol:PoolManager");
    poolManager = await PoolManagerFactory.deploy(owner.address);
    await poolManager.waitForDeployment();

    // Deploy TestablePrivacyPoolHook with library linking
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

    // Deploy SimpleLending
    const SimpleLendingFactory = await ethers.getContractFactory("SimpleLending");
    simpleLending = await SimpleLendingFactory.deploy(await usdc.getAddress());
    await simpleLending.waitForDeployment();

    // Fund SimpleLending with USDC and WETH
    await usdc.mint(owner.address, LIQUIDITY_SOURCE_BALANCE);
    await usdc.approve(await simpleLending.getAddress(), LIQUIDITY_SOURCE_BALANCE);
    await simpleLending.supply(usdc, LIQUIDITY_SOURCE_BALANCE);

    await weth.mint(owner.address, ethers.parseEther("100"));
    await weth.approve(await simpleLending.getAddress(), ethers.parseEther("100"));
    await simpleLending.supply(weth, ethers.parseEther("100"));

    // Set SimpleLending in hook
    await hook.setSimpleLending(await simpleLending.getAddress());

    // Mint tokens to users
    await usdc.mint(alice.address, INITIAL_BALANCE);
    await weth.mint(bob.address, ethers.parseEther("100"));

    // Create poolKey
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

    // Initialize pool
    const sqrtPriceX96 = BigInt("79228162514264337593543950336");
    await poolManager.initialize(poolKey, sqrtPriceX96);

    console.log("[Setup] Liquidity Shuttle Test Environment Ready");
  });

  describe("Configuration", function () {
    it("should have SimpleLending configured", async function () {
      const source = await hook.simpleLending();
      expect(source).to.equal(await simpleLending.getAddress());
    });

    it("should allow owner to set SimpleLending", async function () {
      const newSource = ethers.Wallet.createRandom().address;
      await hook.setSimpleLending(newSource);
      expect(await hook.simpleLending()).to.equal(newSource);
    });

    it("should allow owner to set max swap amount", async function () {
      const usdcAddress = await usdc.getAddress();
      const maxAmount = ethers.parseUnits("10000", 6);

      await hook.setMaxSwapAmount(usdcAddress, maxAmount);
      expect(await hook.maxSwapAmount(usdcAddress)).to.equal(maxAmount);
    });
  });

  describe("SimpleLending Liquidity", function () {
    it("should have USDC liquidity available", async function () {
      const available = await simpleLending.getAvailableBalance(usdc);

      expect(available).to.equal(LIQUIDITY_SOURCE_BALANCE);
      console.log(`  Available USDC: ${ethers.formatUnits(available, 6)}`);
    });

    it("should have WETH liquidity available", async function () {
      const available = await simpleLending.getAvailableBalance(weth);

      expect(available).to.equal(ethers.parseEther("100"));
      console.log(`  Available WETH: ${ethers.formatEther(available)}`);
    });
  });

  describe("BeforeSwap - Withdraw from Lending", function () {
    it("should withdraw liquidity before swap", async function () {
      const usdcAddress = await usdc.getAddress();
      const wethAddress = await weth.getAddress();

      // Check initial SimpleLending balance
      const initialLiquidity = await simpleLending.getAvailableBalance(usdc);

      // Create swap params
      const swapParams = {
        zeroForOne: usdcAddress.toLowerCase() < wethAddress.toLowerCase(),
        amountSpecified: -BigInt(SWAP_AMOUNT),
        sqrtPriceLimitX96: 0,
      };

      // Call beforeSwap (simulating PoolManager calling the hook)
      await hook.testBeforeSwap(alice.address, poolKey, swapParams, "0x");

      console.log("✓ Liquidity withdrawn from lending");
      console.log(`  Amount: ${ethers.formatUnits(SWAP_AMOUNT, 6)} USDC`);

      // Verify SimpleLending balance decreased
      const finalLiquidity = await simpleLending.getAvailableBalance(usdc);
      expect(initialLiquidity - finalLiquidity).to.equal(SWAP_AMOUNT);
    });

    it("should revert if swap amount exceeds limit", async function () {
      const usdcAddress = await usdc.getAddress();
      const wethAddress = await weth.getAddress();

      // Set max swap amount lower than swap
      await hook.setMaxSwapAmount(usdcAddress, SWAP_AMOUNT / 2n);

      const swapParams = {
        zeroForOne: usdcAddress.toLowerCase() < wethAddress.toLowerCase(),
        amountSpecified: -BigInt(SWAP_AMOUNT),
        sqrtPriceLimitX96: 0,
      };

      // Should revert with ERR(14)
      await expect(hook.testBeforeSwap(alice.address, poolKey, swapParams, "0x")).to.be.revertedWithCustomError(
        hook,
        "ERR"
      ).withArgs(14);
    });

    it("should revert if insufficient liquidity", async function () {
      const usdcAddress = await usdc.getAddress();
      const wethAddress = await weth.getAddress();

      // Try to swap more than available
      const hugeAmount = LIQUIDITY_SOURCE_BALANCE + ethers.parseUnits("1000", 6);

      const swapParams = {
        zeroForOne: usdcAddress.toLowerCase() < wethAddress.toLowerCase(),
        amountSpecified: -BigInt(hugeAmount),
        sqrtPriceLimitX96: 0,
      };

      await expect(hook.testBeforeSwap(alice.address, poolKey, swapParams, "0x")).to.be.revertedWithCustomError(
        hook,
        "ERR"
      ).withArgs(15);
    });

    it("should allow hook-initiated swaps to bypass shuttle", async function () {
      const hookAddress = await hook.getAddress();
      const usdcAddress = await usdc.getAddress();
      const wethAddress = await weth.getAddress();

      const initialLiquidity = await simpleLending.getAvailableBalance(usdc);

      const swapParams = {
        zeroForOne: usdcAddress.toLowerCase() < wethAddress.toLowerCase(),
        amountSpecified: -BigInt(SWAP_AMOUNT),
        sqrtPriceLimitX96: 0,
      };

      // Call with hook as sender
      await hook.testBeforeSwap(hookAddress, poolKey, swapParams, "0x");

      // Liquidity should NOT change (shuttle bypassed)
      const finalLiquidity = await simpleLending.getAvailableBalance(usdc);
      expect(finalLiquidity).to.equal(initialLiquidity);

      console.log("✓ Hook-initiated swaps bypass shuttle");
    });
  });

  describe("AfterSwap - Redeposit to Lending", function () {
    it("should redeposit tokens after swap", async function () {
      const usdcAddress = await usdc.getAddress();
      const wethAddress = await weth.getAddress();

      // First, execute beforeSwap to withdraw
      const swapParams = {
        zeroForOne: usdcAddress.toLowerCase() < wethAddress.toLowerCase(),
        amountSpecified: -BigInt(SWAP_AMOUNT),
        sqrtPriceLimitX96: 0,
      };

      await hook.testBeforeSwap(alice.address, poolKey, swapParams, "0x");

      // Simulate swap by transferring some tokens to hook
      // (In real scenario, PoolManager would do this)
      const hookAddress = await hook.getAddress();
      await usdc.mint(hookAddress, SWAP_AMOUNT / 2n); // Some leftover
      await weth.mint(hookAddress, ethers.parseEther("0.5")); // Some output

      // Check initial hook balances
      const initialUSDC = await usdc.balanceOf(hookAddress);
      const initialWETH = await weth.balanceOf(hookAddress);

      console.log(`  Hook USDC before afterSwap: ${ethers.formatUnits(initialUSDC, 6)}`);
      console.log(`  Hook WETH before afterSwap: ${ethers.formatEther(initialWETH)}`);

      // Call afterSwap
      const balanceDelta = 0n;
      await hook.testAfterSwap(alice.address, poolKey, swapParams, balanceDelta, "0x");

      console.log("✓ Tokens redeposited to lending");

      // Verify hook balances are now 0 (all redeposited)
      const finalUSDC = await usdc.balanceOf(hookAddress);
      const finalWETH = await weth.balanceOf(hookAddress);

      expect(finalUSDC).to.equal(0);
      expect(finalWETH).to.equal(0);
    });
  });

  describe("Full Shuttle Flow", function () {
    it("should complete withdraw -> swap -> redeposit cycle", async function () {
      const usdcAddress = await usdc.getAddress();
      const wethAddress = await weth.getAddress();

      // Record initial SimpleLending balances
      const initialUSDCLiquidity = await simpleLending.getAvailableBalance(usdc);
      const initialWETHLiquidity = await simpleLending.getAvailableBalance(weth);

      console.log("\n1. Initial State:");
      console.log(`   Liquidity Source USDC: ${ethers.formatUnits(initialUSDCLiquidity, 6)}`);
      console.log(`   Liquidity Source WETH: ${ethers.formatEther(initialWETHLiquidity)}`);

      // Step 1: beforeSwap withdraws from lending
      console.log("\n2. beforeSwap - Withdraw from lending...");
      const swapParams = {
        zeroForOne: usdcAddress.toLowerCase() < wethAddress.toLowerCase(),
        amountSpecified: -BigInt(SWAP_AMOUNT),
        sqrtPriceLimitX96: 0,
      };

      await hook.testBeforeSwap(alice.address, poolKey, swapParams, "0x");

      const afterWithdrawUSDC = await simpleLending.getAvailableBalance(usdc);
      console.log(`   USDC withdrawn: ${ethers.formatUnits(initialUSDCLiquidity - afterWithdrawUSDC, 6)}`);

      // Step 2: Simulate swap execution (PoolManager gives hook some output tokens)
      const hookAddress = await hook.getAddress();
      const swapOutput = ethers.parseEther("0.5");
      await weth.mint(hookAddress, swapOutput);
      console.log(`\n3. Swap executed - Hook received ${ethers.formatEther(swapOutput)} WETH`);

      // Step 3: afterSwap redeposits to lending
      console.log("\n4. afterSwap - Redeposit to lending...");
      const balanceDelta = 0n;
      await hook.testAfterSwap(alice.address, poolKey, swapParams, balanceDelta, "0x");

      // Verify final state
      const finalUSDCLiquidity = await simpleLending.getAvailableBalance(usdc);
      const finalWETHLiquidity = await simpleLending.getAvailableBalance(weth);

      console.log("\n5. Final State:");
      console.log(`   Liquidity Source USDC: ${ethers.formatUnits(finalUSDCLiquidity, 6)}`);
      console.log(`   Liquidity Source WETH: ${ethers.formatEther(finalWETHLiquidity)}`);

      // Hook should have 0 balance
      const hookUSDC = await usdc.balanceOf(hookAddress);
      const hookWETH = await weth.balanceOf(hookAddress);

      expect(hookUSDC).to.equal(0);
      expect(hookWETH).to.equal(0);

      // WETH liquidity should increase by swap output
      expect(finalWETHLiquidity - initialWETHLiquidity).to.equal(swapOutput);

      console.log("\n✓ Full shuttle cycle completed successfully");
      console.log("  - All withdrawn liquidity returned");
      console.log("  - Swap output deposited");
      console.log("  - Hook balance: 0");
    });
  });
});
