// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {MockPyth as PythMock} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";

contract MockPyth is PythMock {
    constructor(uint64 _validTimePeriod, uint256 _singleUpdateFeeInWei)
        PythMock(_validTimePeriod, _singleUpdateFeeInWei)
    {}
}
