// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.7.6;
pragma experimental ABIEncoderV2;

import "@kyber.network/utils-sc/contracts/IERC20Ext.sol";

interface ILending {
    function depositTo(
        address payable onBehalfOf,
        IERC20Ext token,
        uint256 amount
    ) external;

    function withdrawFrom(
        address payable onBehalfOf,
        IERC20Ext token,
        uint256 amount,
        uint256 minReturn
    ) external returns (uint256 returnedAmount);

    function borrowFrom(
        address payable onBehalfOf,
        IERC20Ext token,
        uint256 borrowAmount,
        uint256 interestRateMode
    ) external;

    function repayBorrowTo(
        address payable onBehalfOf,
        IERC20Ext token,
        uint256 amount,
        uint256 payAmount,
        bytes calldata extraArgs // for extra data .i.e aave rateMode
    ) external;

    function storeAndRetrieveUserDebtCurrent(address _reserve, address _user)
        external
        returns (uint256 debt);

    function getLendingToken(IERC20Ext token) external view returns (address);

    function getUserDebtStored(address reserve, address user) external view returns (uint256 debt);
}
