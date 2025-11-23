// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISimpleLending {
    function supply(IERC20 token, uint256 amount) external;
}

contract SupplyToLending is Script {
    address constant SIMPLE_LENDING = 0x3b64D86362ec9a8Cae77C661ffc95F0bbd440aa2;
    address constant WETH = 0x0003897f666B36bf31Aa48BEEA2A57B16e60448b;
    address constant USDC = 0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0;

    function run() external {
        address deployer = 0x026ba0AA63686278C3b3b3b9C43bEdD8421E36Cd;

        console.log("=== Supplying Tokens to SimpleLending ===");
        console.log("SimpleLending:", SIMPLE_LENDING);
        console.log("Supplier:", deployer);

        vm.startBroadcast(deployer);

        // Supply WETH
        uint256 wethAmount = 10 ether;
        console.log("\nSupplying WETH:", wethAmount);

        // Mint WETH
        bytes memory mintData = abi.encodeWithSignature("mint(address,uint256)", deployer, wethAmount);
        (bool success,) = WETH.call(mintData);
        require(success, "WETH mint failed");

        // Approve and supply
        IERC20(WETH).approve(SIMPLE_LENDING, wethAmount);
        ISimpleLending(SIMPLE_LENDING).supply(IERC20(WETH), wethAmount);
        console.log("WETH supplied");

        // Supply USDC
        uint256 usdcAmount = 10 ether; // Using 18 decimals for mock
        console.log("\nSupplying USDC:", usdcAmount);

        // Mint USDC
        mintData = abi.encodeWithSignature("mint(address,uint256)", deployer, usdcAmount);
        (success,) = USDC.call(mintData);
        require(success, "USDC mint failed");

        // Approve and supply
        IERC20(USDC).approve(SIMPLE_LENDING, usdcAmount);
        ISimpleLending(SIMPLE_LENDING).supply(IERC20(USDC), usdcAmount);
        console.log("USDC supplied");

        vm.stopBroadcast();

        console.log("\n=== Supply Complete! ===");
        console.log("SimpleLending now has liquidity for the hook to withdraw");
    }
}
