// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title DeterministicDeployFactory
 * @notice Factory contract for deploying contracts to deterministic addresses using CREATE2
 * @dev This is essential for Uniswap v4 hooks which require specific addresses with embedded flags
 *
 * WHY THIS IS NEEDED IN HARDHAT:
 * - Uniswap v4 hooks must be deployed to addresses where the address itself encodes permissions
 * - Foundry has built-in tools (vm.etch, deployCodeTo) for this, but we can't use them here
 * - IMPORTANT: Zama (FHEVM) does NOT have Foundry support, so we must use Hardhat
 * - This factory provides CREATE2 deployment capabilities in Hardhat environment
 *
 * HOW CREATE2 WORKS:
 * The deployed contract address is deterministically computed as:
 *   address = keccak256(0xff ++ factory_address ++ salt ++ keccak256(bytecode))[12:]
 *
 * This allows us to:
 * 1. Pre-compute the deployment address before deploying
 * 2. Search for a salt that produces an address with the required hook flags
 * 3. Deploy the hook to that exact address
 *
 * USAGE FLOW:
 * 1. Prepare hook bytecode with constructor args
 * 2. Use computeAddress() to find a salt that gives valid hook address
 * 3. Call deploy() with the bytecode and found salt
 * 4. Hook is deployed to the pre-computed address with correct flags
 */
contract DeterministicDeployFactory {
    event Deploy(address addr);

    /**
     * @notice Deploys a contract using CREATE2
     * @dev Uses inline assembly to access the CREATE2 opcode
     * @param bytecode The creation bytecode of the contract (including constructor args)
     * @param _salt A unique value to influence the resulting address
     * @return addr The address of the deployed contract
     *
     * The CREATE2 opcode takes 4 parameters:
     * 1. value - ETH to send (callvalue())
     * 2. offset - where bytecode starts in memory (add(bytecode, 0x20) skips length prefix)
     * 3. size - bytecode length (mload(bytecode) reads the length)
     * 4. salt - the salt value for deterministic addressing
     */
    function deploy(bytes memory bytecode, uint256 _salt) external payable returns (address) {
        address addr;
        assembly {
            // CREATE2(value, offset, size, salt)
            addr := create2(
                callvalue(), // Forward any ETH sent
                add(bytecode, 0x20), // Skip 32-byte length prefix
                mload(bytecode), // Load bytecode length
                _salt // Salt for deterministic address
            )

            // Verify deployment succeeded by checking code size
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }
        emit Deploy(addr);
        return addr;
    }

    /**
     * @notice Computes the address where a contract would be deployed
     * @dev This allows finding a valid salt before deployment
     * @param bytecode The creation bytecode (must match what will be deployed)
     * @param _salt The salt to use for address computation
     * @return The computed deployment address
     *
     * CRITICAL: The bytecode MUST be exactly the same as what you'll deploy,
     * including constructor arguments. Any difference will result in a different address.
     *
     * For Uniswap v4 hooks, you'll typically:
     * 1. Loop through different salts
     * 2. Call this function for each salt
     * 3. Check if the returned address has the required hook flags in the right position
     * 4. Once found, use that salt in deploy()
     */
    function computeAddress(bytes memory bytecode, uint256 _salt) external view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff), // CREATE2 prefix
                address(this), // Factory address
                bytes32(_salt), // Salt
                keccak256(bytecode) // Hash of initialization code
            )
        );
        return address(uint160(uint256(hash)));
    }
}
