// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {StreamPay} from "../src/StreamPay.sol";

contract DeployStreamPay is Script {
    function run() external returns (StreamPay streamPay) {
        vm.startBroadcast();

        streamPay = new StreamPay();

        vm.stopBroadcast();
    }
}
