// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../contracts/PrivacyPoolHook.sol";

interface ICREATE2Factory {
    function deploy(uint256 value, bytes32 salt, bytes memory code) external;
}

contract DeployWithCREATE2Factory is Script {
    // Standard CREATE2 factory
    address constant DETERMINISTIC_CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Real Uniswap V4 PoolManager on Sepolia
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant PYTH = 0xDd24F84d36BF92C65F92307595335bdFab5Bbd21;
    address constant SETTLEMENT_LIB = 0x75E19a6273beA6888c85B2BF43D57Ab89E7FCb6E;

    function run() external {
        address relayer = vm.envAddress("RELAYER");
        bytes32 salt = bytes32(0); // Mined salt

        console.log("Deploying PrivacyPoolHook via CREATE2 Factory");
        console.log("Factory:", DETERMINISTIC_CREATE2_FACTORY);
        console.log("PoolManager:", POOL_MANAGER);
        console.log("Relayer:", relayer);
        console.log("Pyth:", PYTH);
        console.log("Salt:", vm.toString(salt));

        // Get creation code with constructor args
        bytes memory creationCode = abi.encodePacked(
            type(PrivacyPoolHook).creationCode,
            abi.encode(POOL_MANAGER, relayer, PYTH)
        );

        // Calculate expected address
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                DETERMINISTIC_CREATE2_FACTORY,
                salt,
                keccak256(creationCode)
            )
        );
        address expectedAddress = address(uint160(uint256(hash)));

        console.log("Expected address:", expectedAddress);

        // Verify flags
        uint256 flags = uint256(uint160(expectedAddress)) & 0xFF;
        console.log("Address flags:", vm.toString(bytes32(flags)));

        vm.startBroadcast();

        // Deploy via CREATE2 factory
        ICREATE2Factory(DETERMINISTIC_CREATE2_FACTORY).deploy(0, salt, creationCode);

        console.log("PrivacyPoolHook deployed at:", expectedAddress);

        // Fund the hook
        (bool success,) = expectedAddress.call{value: 0.01 ether}("");
        require(success, "Failed to fund hook");
        console.log("Hook funded with 0.01 ETH");

        vm.stopBroadcast();
    }
}
