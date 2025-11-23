import { task } from "hardhat/config";

task("deposit-tokens", "Deposit tokens into PrivacyPoolHook with FHEVM encryption")
  .addParam("currency", "Token to deposit (weth or usdc)")
  .addParam("amount", "Amount to deposit")
  .setAction(async ({ currency, amount }, hre) => {
    const { deployments, ethers } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Depositing Tokens to PrivacyPoolHook ===\n");
    console.log("From:", signer.address);
    console.log("Currency:", currency.toUpperCase());
    console.log("Amount:", amount);

    // Real deployed addresses on Sepolia
    const hookAddress = "0x80B884a77Cb6167B884d3419019Df790E65440C0";
    const usdcDeploy = await deployments.get("MockERC20_USDC");
    const wethDeploy = await deployments.get("MockERC20_WETH");

    const hook = await ethers.getContractAt("PrivacyPoolHook", hookAddress);

    // Determine which token
    let tokenAddress: string;
    let tokenDecimals: number;
    if (currency.toLowerCase() === "usdc") {
      tokenAddress = usdcDeploy.address;
      tokenDecimals = 6;
    } else if (currency.toLowerCase() === "weth") {
      tokenAddress = wethDeploy.address;
      tokenDecimals = 18;
    } else {
      throw new Error("Currency must be 'weth' or 'usdc'");
    }

    const token = await ethers.getContractAt("MockERC20", tokenAddress);

    // Sort currencies for poolKey
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
    const depositAmount = ethers.parseUnits(amount, tokenDecimals);
    console.log("Deposit amount (wei):", depositAmount.toString());

    console.log("\n[1/4] Minting tokens...");
    const mintTx = await token.mint(signer.address, depositAmount);
    await mintTx.wait();
    console.log("✅ Minted", amount, currency.toUpperCase());

    console.log("\n[2/4] Approving hook...");
    const approveTx = await token.approve(hookAddress, depositAmount);
    await approveTx.wait();
    console.log("✅ Approved");

    console.log("\n[3/3] Depositing to hook...");
    console.log("Note: The hook will internally convert to encrypted tokens");
    const depositTx = await hook.deposit(
      poolKey,
      tokenAddress,
      depositAmount
    );
    const receipt = await depositTx.wait();
    console.log("✅ Deposited!");
    console.log("Transaction:", receipt?.hash);

    console.log("\n=== Deposit Complete! ===\n");
    console.log("Your encrypted balance is now stored in the hook");
  });
