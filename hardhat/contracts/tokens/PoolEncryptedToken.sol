// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC7984} from "openzeppelin-confidential-contracts/contracts/token/ERC7984/ERC7984.sol";
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title PoolEncryptedToken
 * @notice Encrypted token for a specific pool and currency, extending ERC7984
 * @dev Minimal extension of ERC7984 that only adds hook-controlled minting/burning
 *
 * ERC7984 already provides:
 * - confidentialTransfer() - transfer encrypted amounts
 * - confidentialTransferFrom() - operator transfers
 * - confidentialBalanceOf() - get encrypted balance
 * - _mint(), _burn(), _transfer() - internal functions
 *
 * We only add:
 * - Hook-only mint/burn functions
 * - Pool/currency metadata
 */
contract PoolEncryptedToken is ZamaEthereumConfig, ERC7984, Ownable2Step {
    // =============================================================
    //                      STATE VARIABLES
    // =============================================================

    /// @notice Address of the underlying ERC20 token
    address public immutable underlyingToken;

    /// @notice Pool ID this token belongs to
    bytes32 public immutable poolId;

    /// @notice Hook address that controls minting/burning
    address public hook;

    // =============================================================
    //                           EVENTS
    // =============================================================

    event HookUpdated(address indexed oldHook, address indexed newHook);

    // =============================================================
    //                           ERRORS
    // =============================================================

    error OnlyHook();
    error InvalidHook();
    error ZeroAddress();

    // =============================================================
    //                         MODIFIERS
    // =============================================================

    modifier onlyHook() {
        if (msg.sender != hook) revert OnlyHook();
        _;
    }

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor(
        address _underlyingToken,
        bytes32 _poolId,
        address _hook,
        string memory _name,
        string memory _symbol,
        string memory _tokenURI
    ) ERC7984(_name, _symbol, _tokenURI) Ownable(msg.sender) {
        if (_underlyingToken == address(0)) revert ZeroAddress();
        if (_hook == address(0)) revert InvalidHook();

        underlyingToken = _underlyingToken;
        poolId = _poolId;
        hook = _hook;
    }

    // =============================================================
    //                   HOOK-CONTROLLED FUNCTIONS
    // =============================================================

    /**
     * @notice Mint encrypted tokens (hook only)
     * @dev Uses ERC7984's internal _mint
     */
    function mint(address to, euint64 amount) external onlyHook returns (euint64) {
        return _mint(to, amount);
    }

    /**
     * @notice Burn encrypted tokens (hook only)
     * @dev Uses ERC7984's internal _burn
     */
    function burn(address from, euint64 amount) external onlyHook returns (euint64) {
        return _burn(from, amount);
    }

    /**
     * @notice Transfer between users (hook only for settlements)
     * @dev Uses ERC7984's internal _transfer
     */
    function hookTransfer(address from, address to, euint64 amount) external onlyHook returns (euint64) {
        return _transfer(from, to, amount);
    }

    // =============================================================
    //                     ADMIN FUNCTIONS
    // =============================================================

    function updateHook(address newHook) external onlyOwner {
        if (newHook == address(0)) revert InvalidHook();
        address oldHook = hook;
        hook = newHook;
        emit HookUpdated(oldHook, newHook);
    }

    // =============================================================
    //                       VIEW FUNCTIONS
    // =============================================================

    function getTokenInfo() external view returns (address _underlying, bytes32 _poolId, address _hook) {
        return (underlyingToken, poolId, hook);
    }
}
