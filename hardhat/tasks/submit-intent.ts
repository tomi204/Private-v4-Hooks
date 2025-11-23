import { task } from "hardhat/config";

task("submit-intent", "Submit encrypted swap intent")
  .addParam("currency", "Input currency (USDC or WETH)")
  .addParam("amount", "Amount to swap")
  .addParam("action", "Swap action: 0=SWAP_0_TO_1, 1=SWAP_1_TO_0")
  .setAction(async ({ currency, amount, action }, hre) => {
    const { deployments, ethers, fhevm } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Submitting Encrypted Intent ===\n");

    // Real deployed addresses on Sepolia
    const hookAddress = "0x80B884a77Cb6167B884d3419019Df790E65440C0";
    const usdcDeploy = await deployments.get("MockERC20_USDC");
    const wethDeploy = await deployments.get("MockERC20_WETH");

    const hook = await ethers.getContractAt("PrivacyPoolHook", hookAddress);

    // Determine token
    let currencyAddress: string;
    let decimals: number;
    if (currency.toLowerCase() === "usdc") {
      currencyAddress = usdcDeploy.address;
      decimals = 6;
    } else if (currency.toLowerCase() === "weth") {
      currencyAddress = wethDeploy.address;
      decimals = 18;
    } else {
      currencyAddress = currency;
      decimals = 18;
    }

    // Create poolKey
    const usdcAddress = usdcDeploy.address;
    const wethAddress = wethDeploy.address;
    const [currency0, currency1] =
      usdcAddress.toLowerCase() < wethAddress.toLowerCase()
        ? [usdcAddress, wethAddress]
        : [wethAddress, usdcAddress];

    const poolKey = {
      currency0,
      currency1,
      fee: 3000,
      tickSpacing: 60,
      hooks: hookAddress,
    };

    // Parse amount
    const swapAmount = ethers.parseUnits(amount, decimals);
    console.log("Input currency:", currencyAddress);
    console.log("Swap amount:", amount);
    console.log("Action:", action === "0" ? "SWAP_0_TO_1" : "SWAP_1_TO_0");

    // Initialize FHEVM
    console.log("\n1. Initializing FHEVM...");
    await fhevm.initializeCLIApi();
    console.log("✅ FHEVM initialized");

    // Create encrypted inputs using FHEVM
    console.log("\n2. Creating encrypted amount...");
    const encAmount = await fhevm
      .createEncryptedInput(hookAddress, signer.address)
      .add64(Number(swapAmount))
      .encrypt();

    console.log("✅ Encrypted amount created");

    console.log("\n3. Creating encrypted action...");
    const encAction = await fhevm
      .createEncryptedInput(hookAddress, signer.address)
      .add8(Number(action))
      .encrypt();

    console.log("✅ Encrypted action created");

    // Set operator permission first
    console.log("\n4. Setting operator permission...");
    const poolId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
      )
    );
    const encryptedTokenAddress = await hook.poolEncryptedTokens(poolId, currencyAddress);

    if (encryptedTokenAddress === ethers.ZeroAddress) {
      console.log("❌ No encrypted token found. Did you deposit first?");
      return;
    }

    const encryptedToken = await ethers.getContractAt("PoolEncryptedToken", encryptedTokenAddress);
    const maxExpiry = 2n ** 48n - 1n;
    const setOpTx = await encryptedToken.setOperator(hookAddress, maxExpiry);
    await setOpTx.wait();
    console.log("✅ Operator set");

    // Submit intent
    console.log("\n5. Submitting intent...");
    const tx = await hook.submitIntent(
      poolKey,
      currencyAddress,
      encAmount.handles[0],
      encAmount.inputProof,
      encAction.handles[0],
      encAction.inputProof,
      0 // deadline
    );

    const receipt = await tx.wait();
    console.log("✅ Intent submitted!");
    console.log("Tx:", receipt?.hash);

    // Get batch ID
    const batchId = await hook.currentBatchId(poolId);
    console.log("\nBatch ID:", batchId);

    console.log("\n✅ Intent submission complete!\n");
  });
