// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title ClearCause goal-based charitable fundraising
/// @notice Testnet coursework. Permissionless campaigns are not verified charities.
contract CharityFund {
    struct Campaign {
        address creator;
        address payable beneficiary;
        uint256 goal;
        uint256 raised;
        uint256 refunded;
        uint64 deadline;
        bool withdrawn;
        string title;
        string description;
        uint8 category;
    }
    enum Status { Active, Funded, Paid, Refundable }
    uint256 public campaignCount;
    mapping(uint256 => Campaign) private campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    uint256 private entered = 1;

    error InvalidCampaign();
    error InvalidInput();
    error CampaignClosed();
    error Unauthorized();
    error NotFunded();
    error RefundUnavailable();
    error NothingToRefund();
    error TransferFailed();
    error Reentrancy();

    event CampaignCreated(uint256 indexed id, address indexed creator, address indexed beneficiary, uint256 goal, uint64 deadline);
    event Donated(uint256 indexed id, address indexed donor, uint256 amount, uint256 totalRaised);
    event Withdrawn(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event Refunded(uint256 indexed id, address indexed donor, uint256 amount);

    modifier nonReentrant() {
        if (entered != 1) revert Reentrancy();
        entered = 2;
        _;
        entered = 1;
    }

    function createCampaign(string calldata title, string calldata description, address payable beneficiary,
        uint256 goal, uint64 deadline, uint8 category) external returns (uint256 id) {
        if (bytes(title).length == 0 || bytes(title).length > 96 || bytes(description).length == 0 ||
            bytes(description).length > 1600 || beneficiary == address(0) || beneficiary == address(this) || goal == 0 ||
            deadline <= block.timestamp || deadline > block.timestamp + 365 days || category > 3) revert InvalidInput();
        id = campaignCount++;
        campaigns[id] = Campaign(msg.sender, beneficiary, goal, 0, 0, deadline, false, title, description, category);
        emit CampaignCreated(id, msg.sender, beneficiary, goal, deadline);
    }

    function getCampaign(uint256 id) public view returns (Campaign memory) {
        if (id >= campaignCount) revert InvalidCampaign();
        return campaigns[id];
    }

    function status(uint256 id) public view returns (Status) {
        Campaign memory c = getCampaign(id);
        if (c.withdrawn) return Status.Paid;
        if (c.raised >= c.goal) return Status.Funded;
        if (block.timestamp >= c.deadline) return Status.Refundable;
        return Status.Active;
    }

    /// @dev A final donation may exceed the goal. Further donations then close.
    function donate(uint256 id) external payable nonReentrant {
        if (status(id) != Status.Active) revert CampaignClosed();
        if (msg.value == 0) revert InvalidInput();
        Campaign storage c = campaigns[id];
        c.raised += msg.value;
        contributions[id][msg.sender] += msg.value;
        emit Donated(id, msg.sender, msg.value, c.raised);
    }

    function withdraw(uint256 id) external nonReentrant {
        Campaign memory c = getCampaign(id);
        if (msg.sender != c.beneficiary) revert Unauthorized();
        if (status(id) != Status.Funded) revert NotFunded();
        campaigns[id].withdrawn = true;
        (bool ok,) = c.beneficiary.call{value: c.raised}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(id, msg.sender, c.raised);
    }

    /// @dev Pull refunds avoid a loop over donors and isolate recipient failures.
    function refund(uint256 id) external nonReentrant {
        if (status(id) != Status.Refundable) revert RefundUnavailable();
        uint256 amount = contributions[id][msg.sender];
        if (amount == 0) revert NothingToRefund();
        contributions[id][msg.sender] = 0;
        campaigns[id].refunded += amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Refunded(id, msg.sender, amount);
    }
}
