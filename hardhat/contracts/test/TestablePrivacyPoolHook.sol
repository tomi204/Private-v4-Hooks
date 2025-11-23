// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {PrivacyPoolHook} from "../PrivacyPoolHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";

/**
 * @title TestablePrivacyPoolHook
 * @notice Testable version of PrivacyPoolHook that skips address validation
 * @dev This contract is for testing purposes only. It overrides validateHookAddress
 *      to skip the address validation that requires specific hook addresses in production.
 */
contract TestablePrivacyPoolHook is PrivacyPoolHook {
    constructor(IPoolManager _poolManager, address _relayer) PrivacyPoolHook(_poolManager, _relayer) {}

    /**
     * @notice Override to skip validation in test environment
     * @dev In production, BaseHook validates that the hook address matches
     *      the required permissions. For testing, we skip this validation.
     */
    function validateHookAddress(BaseHook) internal pure override {
        // Skip validation in test environment
    }
}
