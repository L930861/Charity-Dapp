// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
interface IFund {
    function donate(uint256) external payable;
    function refund(uint256) external;
    function withdraw(uint256) external;
}
contract Receiver {
    IFund public fund;
    uint256 public id;
    bool public reject;
    bool public attack;
    bool public reentrySucceeded;
    constructor(address target) { fund = IFund(target); }
    function configure(uint256 campaign, bool rejection, bool reentry) external { id=campaign; reject=rejection; attack=reentry; }
    function give() external payable { fund.donate{value: msg.value}(id); }
    function claim() external { fund.refund(id); }
    function collect() external { fund.withdraw(id); }
    receive() external payable {
        require(!reject, "receiver rejected");
        if (attack) { (reentrySucceeded,) = address(fund).call(abi.encodeCall(IFund.refund, (id))); }
    }
}
