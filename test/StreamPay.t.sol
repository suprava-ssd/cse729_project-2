// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {StreamPay} from "../src/StreamPay.sol";

contract StreamPayTest is Test {
    StreamPay public streamPay;

    address public admin;
    address public employer;
    address public employee;
    address public outsider;

    function setUp() public {
        // Give us a predictable blockchain timestamp.
        vm.warp(1_000_000);

        admin = makeAddr("admin");
        employer = makeAddr("employer");
        employee = makeAddr("employee");
        outsider = makeAddr("outsider");

        // Give test accounts fake ETH.
        vm.deal(admin, 10 ether);
        vm.deal(employer, 100 ether);
        vm.deal(employee, 1 ether);
        vm.deal(outsider, 10 ether);

        // Deploy StreamPay from the Admin account.
        vm.startPrank(admin);
        streamPay = new StreamPay();
        vm.stopPrank();

        // Employer registers the Employee.
        vm.prank(employer);
        streamPay.registerEmployee(employee);
    }

    function _createStream(uint256 amount, uint256 duration) internal returns (uint256) {
        vm.prank(employer);

        return streamPay.createStream{value: amount}(payable(employee), duration);
    }

    // ---------------------------------------------------------
    // TEST 1: ADMIN
    // ---------------------------------------------------------

    function testAdminIsDeployer() public view {
        assertEq(streamPay.admin(), admin);
    }

    // ---------------------------------------------------------
    // TEST 2: COMPANY / EMPLOYEE REGISTRATION
    // ---------------------------------------------------------

    function testEmployeeIsRegisteredUnderEmployerCompany() public view {
        uint256 companyId = streamPay.companyIdOf(employer);

        assertEq(companyId, 1);

        assertTrue(streamPay.registeredEmployees(companyId, employee));
    }

    // ---------------------------------------------------------
    // TEST 3: ZERO ETH MUST FAIL
    // ---------------------------------------------------------

    function testCannotCreateZeroETHStream() public {
        vm.prank(employer);

        vm.expectRevert(bytes("ETH amount must be greater than zero"));

        streamPay.createStream{value: 0}(payable(employee), 100);
    }

    // ---------------------------------------------------------
    // TEST 4: DURATION MUST BE > 15
    // ---------------------------------------------------------

    function testDurationMustBeGreaterThan15Seconds() public {
        vm.prank(employer);

        vm.expectRevert(bytes("Duration must be greater than 15 seconds"));

        streamPay.createStream{value: 1 ether}(payable(employee), 15);
    }

    // ---------------------------------------------------------
    // TEST 5: STREAM CREATION
    // ---------------------------------------------------------

    function testEmployerCanCreateStream() public {
        uint256 streamId = _createStream(10 ether, 100);

        StreamPay.Stream memory stream = streamPay.getStream(streamId);

        assertEq(stream.id, 1);
        assertEq(stream.companyId, 1);

        assertEq(stream.employer, employer);

        assertEq(stream.employee, employee);

        assertEq(stream.totalDeposit, 10 ether);

        assertEq(stream.duration, 100);

        assertEq(stream.totalWithdrawn, 0);

        assertEq(uint256(stream.status), uint256(StreamPay.StreamStatus.Active));
    }

    // ---------------------------------------------------------
    // TEST 6: CONTINUOUS VESTING MATH
    // ---------------------------------------------------------

    function testHalfwayUnlocksExactlyHalfSalary() public {
        uint256 streamId = _createStream(10 ether, 100);

        StreamPay.Stream memory stream = streamPay.getStream(streamId);

        // Move blockchain time forward 50 seconds.
        vm.warp(stream.startTime + 50);

        uint256 unlocked = streamPay.getUnlockedAmount(streamId);

        assertEq(unlocked, 5 ether);
    }

    // ---------------------------------------------------------
    // TEST 7: FULL VESTING
    // ---------------------------------------------------------

    function testFullSalaryUnlocksAtEnd() public {
        uint256 streamId = _createStream(10 ether, 100);

        StreamPay.Stream memory stream = streamPay.getStream(streamId);

        vm.warp(stream.startTime + 100);

        uint256 unlocked = streamPay.getUnlockedAmount(streamId);

        assertEq(unlocked, 10 ether);
    }

    // ---------------------------------------------------------
    // TEST 8: PARTIAL WITHDRAWAL + EXACT 1% FEE
    // ---------------------------------------------------------

    function testPartialWithdrawalAndOnePercentFee() public {
        uint256 streamId = _createStream(10 ether, 100);

        StreamPay.Stream memory stream = streamPay.getStream(streamId);

        vm.warp(stream.startTime + 50);

        uint256 employeeBalanceBefore = employee.balance;

        vm.prank(employee);
        streamPay.withdraw(streamId);

        // Half of 10 ETH = 5 ETH gross vested.
        uint256 grossAmount = 5 ether;

        // Exactly 1%.
        uint256 expectedFee = grossAmount / 100;

        uint256 expectedEmployeeAmount = grossAmount - expectedFee;

        assertEq(employee.balance - employeeBalanceBefore, expectedEmployeeAmount);

        assertEq(streamPay.adminWithdrawable(), expectedFee);

        StreamPay.Stream memory updated = streamPay.getStream(streamId);

        assertEq(updated.totalWithdrawn, 5 ether);

        assertEq(updated.totalFeeCharged, expectedFee);
    }

    // ---------------------------------------------------------
    // TEST 9: MULTIPLE WITHDRAWALS STILL TOTAL EXACTLY 1%
    // ---------------------------------------------------------

    function testMultipleWithdrawalsStillChargeExactlyOnePercent() public {
        uint256 streamId = _createStream(10 ether, 100);

        StreamPay.Stream memory stream = streamPay.getStream(streamId);

        uint256 employeeBalanceBefore = employee.balance;

        // First withdrawal at 25%.
        vm.warp(stream.startTime + 25);

        vm.prank(employee);
        streamPay.withdraw(streamId);

        // Second withdrawal when completely vested.
        vm.warp(stream.startTime + 100);

        vm.prank(employee);
        streamPay.withdraw(streamId);

        uint256 expectedTotalFee = 10 ether / 100;

        uint256 expectedEmployeeAmount = 10 ether - expectedTotalFee;

        assertEq(streamPay.adminWithdrawable(), expectedTotalFee);

        assertEq(employee.balance - employeeBalanceBefore, expectedEmployeeAmount);
    }

    // ---------------------------------------------------------
    // TEST 10: CANCELLATION REFUND
    // ---------------------------------------------------------

    function testCancellationPaysVestedAndRefundsUnvestedETH() public {
        uint256 streamId = _createStream(10 ether, 100);

        StreamPay.Stream memory stream = streamPay.getStream(streamId);

        vm.warp(stream.startTime + 50);

        uint256 employeeBefore = employee.balance;

        uint256 employerBefore = employer.balance;

        vm.prank(employer);
        streamPay.cancelStream(streamId);

        // 50% vested = 5 ETH.
        uint256 vestedAmount = 5 ether;

        uint256 expectedFee = vestedAmount / 100;

        uint256 expectedEmployeeAmount = vestedAmount - expectedFee;

        // Remaining 5 ETH goes back to Employer.
        uint256 expectedEmployerRefund = 5 ether;

        assertEq(employee.balance - employeeBefore, expectedEmployeeAmount);

        assertEq(employer.balance - employerBefore, expectedEmployerRefund);

        assertEq(streamPay.adminWithdrawable(), expectedFee);

        StreamPay.Stream memory updated = streamPay.getStream(streamId);

        assertEq(uint256(updated.status), uint256(StreamPay.StreamStatus.Closed));

        assertEq(updated.totalWithdrawn, vestedAmount);
    }

    // ---------------------------------------------------------
    // TEST 11: EMPLOYEE MAY ALSO CANCEL
    // ---------------------------------------------------------

    function testEmployeeCanCancelStream() public {
        uint256 streamId = _createStream(2 ether, 20);

        StreamPay.Stream memory stream = streamPay.getStream(streamId);

        vm.warp(stream.startTime + 10);

        vm.prank(employee);
        streamPay.cancelStream(streamId);

        StreamPay.Stream memory updated = streamPay.getStream(streamId);

        assertEq(uint256(updated.status), uint256(StreamPay.StreamStatus.Closed));
    }

    // ---------------------------------------------------------
    // TEST 12: RANDOM ACCOUNT CANNOT CANCEL
    // ---------------------------------------------------------

    function testUnauthorizedAccountCannotCancelStream() public {
        uint256 streamId = _createStream(10 ether, 100);

        vm.prank(outsider);

        vm.expectRevert(bytes("Not authorized"));

        streamPay.cancelStream(streamId);
    }

    // ---------------------------------------------------------
    // TEST 13: ADMIN CAN CLAIM FEES
    // ---------------------------------------------------------

    function testAdminCanClaimProtocolFees() public {
        uint256 streamId = _createStream(10 ether, 100);

        StreamPay.Stream memory stream = streamPay.getStream(streamId);

        vm.warp(stream.startTime + 50);

        vm.prank(employee);
        streamPay.withdraw(streamId);

        uint256 expectedFee = 5 ether / 100;

        assertEq(streamPay.adminWithdrawable(), expectedFee);

        uint256 adminBalanceBefore = admin.balance;

        vm.prank(admin);
        streamPay.claimAdminFees();

        assertEq(admin.balance - adminBalanceBefore, expectedFee);

        assertEq(streamPay.adminWithdrawable(), 0);
    }
}
