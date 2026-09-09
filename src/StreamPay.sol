// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract StreamPay {
    // ------------------------------------------------------------
    // DATA TYPES
    // ------------------------------------------------------------

    enum StreamStatus {
        Active,
        Closed
    }

    struct Stream {
        uint256 id;
        uint256 companyId;
        address payable employer;
        address payable employee;
        uint256 totalDeposit;
        uint256 startTime;
        uint256 duration;
        uint256 totalWithdrawn;
        uint256 totalFeeCharged;
        StreamStatus status;
    }

    // ------------------------------------------------------------
    // STATE VARIABLES
    // ------------------------------------------------------------

    address public immutable admin;

    uint256 public adminWithdrawable;

    uint256 public nextStreamId = 1;
    uint256 public nextCompanyId = 1;

    mapping(uint256 => Stream) private streams;

    mapping(address => uint256) public companyIdOf;

    mapping(uint256 => address) public companyOwner;

    mapping(uint256 => mapping(address => bool))
        public registeredEmployees;

    mapping(address => uint256[]) private employerStreamIds;

    mapping(address => uint256[]) private employeeStreamIds;

    bool private locked;

    // ------------------------------------------------------------
    // EVENTS
    // ------------------------------------------------------------

    event CompanyRegistered(
        uint256 indexed companyId,
        address indexed employer
    );

    event EmployeeRegistered(
        uint256 indexed companyId,
        address indexed employer,
        address indexed employee
    );

    event StreamCreated(
        uint256 indexed streamId,
        uint256 indexed companyId,
        address indexed employer,
        address employee,
        uint256 deposit,
        uint256 startTime,
        uint256 duration
    );

    event StreamWithdrawn(
        uint256 indexed streamId,
        address indexed employee,
        uint256 grossAmount,
        uint256 protocolFee,
        uint256 employeeAmount
    );

    event StreamCancelled(
        uint256 indexed streamId,
        uint256 vestedAmount,
        uint256 protocolFee,
        uint256 employeeAmount,
        uint256 employerRefund
    );

    event StreamCompleted(
        uint256 indexed streamId
    );

    event AdminFeesClaimed(
        address indexed admin,
        uint256 amount
    );

    // ------------------------------------------------------------
    // MODIFIERS
    // ------------------------------------------------------------

    modifier nonReentrant() {
        require(!locked, "Reentrancy blocked");

        locked = true;

        _;

        locked = false;
    }

    modifier streamExists(uint256 streamId) {
        require(
            streams[streamId].id != 0,
            "Stream does not exist"
        );

        _;
    }

    // ------------------------------------------------------------
    // CONSTRUCTOR
    // ------------------------------------------------------------

    constructor() {
        admin = msg.sender;
    }

    // ------------------------------------------------------------
    // EMPLOYEE REGISTRATION
    // ------------------------------------------------------------

    function registerEmployee(
        address employee
    ) external {
        require(
            employee != address(0),
            "Invalid employee address"
        );

        uint256 companyId = companyIdOf[msg.sender];

        /*
            If this employer does not yet have a company ID,
            automatically create one.
        */

        if (companyId == 0) {
            companyId = nextCompanyId;

            nextCompanyId++;

            companyIdOf[msg.sender] = companyId;

            companyOwner[companyId] = msg.sender;

            emit CompanyRegistered(
                companyId,
                msg.sender
            );
        }

        require(
            !registeredEmployees[companyId][employee],
            "Employee already registered"
        );

        registeredEmployees[companyId][employee] = true;

        emit EmployeeRegistered(
            companyId,
            msg.sender,
            employee
        );
    }

    // ------------------------------------------------------------
    // CREATE STREAM
    // ------------------------------------------------------------

    function createStream(
        address payable employee,
        uint256 duration
    )
        external
        payable
        returns (uint256 streamId)
    {
        require(
            msg.value > 0,
            "ETH amount must be greater than zero"
        );

        require(
            duration > 15,
            "Duration must be greater than 15 seconds"
        );

        require(
            employee != address(0),
            "Invalid employee address"
        );

        uint256 companyId = companyIdOf[msg.sender];

        require(
            companyId != 0,
            "Employer has no company"
        );

        require(
            registeredEmployees[companyId][employee],
            "Employee is not registered"
        );

        streamId = nextStreamId;

        nextStreamId++;

        streams[streamId] = Stream({
            id: streamId,
            companyId: companyId,
            employer: payable(msg.sender),
            employee: employee,
            totalDeposit: msg.value,
            startTime: block.timestamp,
            duration: duration,
            totalWithdrawn: 0,
            totalFeeCharged: 0,
            status: StreamStatus.Active
        });

        employerStreamIds[msg.sender].push(streamId);

        employeeStreamIds[employee].push(streamId);

        emit StreamCreated(
            streamId,
            companyId,
            msg.sender,
            employee,
            msg.value,
            block.timestamp,
            duration
        );
    }

    // ------------------------------------------------------------
    // STREAMING / VESTING CALCULATION
    // ------------------------------------------------------------

    function getUnlockedAmount(
        uint256 streamId
    )
        public
        view
        streamExists(streamId)
        returns (uint256)
    {
        Stream storage stream = streams[streamId];

        /*
            A cancelled/completed stream no longer changes
            with time.
        */

        if (stream.status == StreamStatus.Closed) {
            return stream.totalWithdrawn;
        }

        uint256 endTime =
            stream.startTime + stream.duration;

        /*
            When stream has reached the end,
            the entire salary is unlocked.
        */

        if (block.timestamp >= endTime) {
            return stream.totalDeposit;
        }

        uint256 elapsedTime =
            block.timestamp - stream.startTime;

        /*
            Required assignment formula:

            Unlocked =
            Total Deposit * Time Elapsed
            --------------------------------
                      Duration
        */

        return (
            stream.totalDeposit * elapsedTime
        ) / stream.duration;
    }

    // ------------------------------------------------------------
    // VIEW CLAIMABLE SALARY
    // ------------------------------------------------------------

    function getClaimableAmount(
        uint256 streamId
    )
        external
        view
        streamExists(streamId)
        returns (
            uint256 grossAmount,
            uint256 fee,
            uint256 employeeAmount
        )
    {
        Stream storage stream = streams[streamId];

        if (stream.status == StreamStatus.Closed) {
            return (0, 0, 0);
        }

        uint256 unlocked =
            getUnlockedAmount(streamId);

        if (unlocked <= stream.totalWithdrawn) {
            return (0, 0, 0);
        }

        grossAmount =
            unlocked - stream.totalWithdrawn;

        uint256 newTotalWithdrawn =
            stream.totalWithdrawn + grossAmount;

        uint256 totalFeeRequired =
            newTotalWithdrawn / 100;

        fee =
            totalFeeRequired -
            stream.totalFeeCharged;

        employeeAmount =
            grossAmount - fee;
    }

    // ------------------------------------------------------------
    // EMPLOYEE WITHDRAWAL
    // ------------------------------------------------------------

    function withdraw(
        uint256 streamId
    )
        external
        nonReentrant
        streamExists(streamId)
    {
        Stream storage stream = streams[streamId];

        require(
            stream.status == StreamStatus.Active,
            "Stream is closed"
        );

        require(
            msg.sender == stream.employee,
            "Only employee can withdraw"
        );

        uint256 unlocked =
            getUnlockedAmount(streamId);

        require(
            unlocked > stream.totalWithdrawn,
            "Nothing available to withdraw"
        );

        uint256 grossAmount =
            unlocked - stream.totalWithdrawn;

        uint256 newTotalWithdrawn =
            stream.totalWithdrawn + grossAmount;

        /*
            1% cumulative fee.

            This approach keeps the final protocol fee
            exactly 1% of the settled gross amount,
            even if an employee makes several withdrawals.
        */

        uint256 totalFeeRequired =
            newTotalWithdrawn / 100;

        uint256 fee =
            totalFeeRequired -
            stream.totalFeeCharged;

        uint256 employeeAmount =
            grossAmount - fee;

        // Update state before transferring ETH.

        stream.totalWithdrawn =
            newTotalWithdrawn;

        stream.totalFeeCharged =
            totalFeeRequired;

        adminWithdrawable += fee;

        if (
            stream.totalWithdrawn ==
            stream.totalDeposit
        ) {
            stream.status = StreamStatus.Closed;

            emit StreamCompleted(streamId);
        }

        (bool success, ) =
            stream.employee.call{
                value: employeeAmount
            }("");

        require(
            success,
            "Employee transfer failed"
        );

        emit StreamWithdrawn(
            streamId,
            stream.employee,
            grossAmount,
            fee,
            employeeAmount
        );
    }

    // ------------------------------------------------------------
    // CANCEL STREAM
    // ------------------------------------------------------------

    function cancelStream(
        uint256 streamId
    )
        external
        nonReentrant
        streamExists(streamId)
    {
        Stream storage stream = streams[streamId];

        require(
            stream.status == StreamStatus.Active,
            "Stream is already closed"
        );

        require(
            msg.sender == stream.employer ||
            msg.sender == stream.employee,
            "Not authorized"
        );

        uint256 unlocked =
            getUnlockedAmount(streamId);

        uint256 vestedRemaining =
            unlocked - stream.totalWithdrawn;

        uint256 newTotalWithdrawn =
            unlocked;

        uint256 totalFeeRequired =
            newTotalWithdrawn / 100;

        uint256 fee =
            totalFeeRequired -
            stream.totalFeeCharged;

        uint256 employeeAmount =
            vestedRemaining - fee;

        uint256 employerRefund =
            stream.totalDeposit - unlocked;

        // Close the stream before sending ETH.

        stream.totalWithdrawn =
            newTotalWithdrawn;

        stream.totalFeeCharged =
            totalFeeRequired;

        stream.status =
            StreamStatus.Closed;

        adminWithdrawable += fee;

        if (employeeAmount > 0) {
            (bool employeeSuccess, ) =
                stream.employee.call{
                    value: employeeAmount
                }("");

            require(
                employeeSuccess,
                "Employee transfer failed"
            );
        }

        if (employerRefund > 0) {
            (bool employerSuccess, ) =
                stream.employer.call{
                    value: employerRefund
                }("");

            require(
                employerSuccess,
                "Employer refund failed"
            );
        }

        emit StreamCancelled(
            streamId,
            vestedRemaining,
            fee,
            employeeAmount,
            employerRefund
        );
    }

    // ------------------------------------------------------------
    // ADMIN CLAIMS PROTOCOL FEES
    // ------------------------------------------------------------

    function claimAdminFees()
        external
        nonReentrant
    {
        require(
            msg.sender == admin,
            "Only admin"
        );

        uint256 amount =
            adminWithdrawable;

        require(
            amount > 0,
            "No fees available"
        );

        adminWithdrawable = 0;

        (bool success, ) =
            payable(admin).call{
                value: amount
            }("");

        require(
            success,
            "Admin transfer failed"
        );

        emit AdminFeesClaimed(
            admin,
            amount
        );
    }

    // ------------------------------------------------------------
    // FRONTEND GETTERS
    // ------------------------------------------------------------

    function getStream(
        uint256 streamId
    )
        external
        view
        streamExists(streamId)
        returns (Stream memory)
    {
        return streams[streamId];
    }

    function getEmployerStreamIds(
        address employer
    )
        external
        view
        returns (uint256[] memory)
    {
        return employerStreamIds[employer];
    }

    function getEmployeeStreamIds(
        address employee
    )
        external
        view
        returns (uint256[] memory)
    {
        return employeeStreamIds[employee];
    }
}