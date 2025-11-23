import { task } from "hardhat/config";

task("withdraw-tokens", "Withdraw encrypted tokens back to ERC20")
  .addParam("currency", "Token to withdraw (weth or usdc)")
  .addParam("amount", "Amount to withdraw")
  .setAction(async ({ currency, amount }, hre) => {
    const { deployments, ethers } = hre;
    const [signer] = await ethers.getSigners();

    console.log("\n=== Withdrawing Tokens from PrivacyPoolHook ===\n");
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
    const withdrawAmount = ethers.parseUnits(amount, tokenDecimals);
    console.log("Withdraw amount (wei):", withdrawAmount.toString());

    console.log("\n[1/1] Withdrawing from hook...");
    console.log("Note: The hook will burn encrypted tokens and return ERC20");
    const withdrawTx = await hook.withdraw(
      poolKey,
      tokenAddress,
      withdrawAmount,
      signer.address
    );
    const receipt = await withdrawTx.wait();
    console.log("✅ Withdrawn!");
    console.log("Transaction:", receipt?.hash);

    console.log("\n=== Withdrawal Complete! ===\n");
    console.log("ERC20 tokens have been returned to your wallet");
  });
