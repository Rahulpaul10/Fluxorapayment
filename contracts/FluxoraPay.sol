// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Minimal ERC-20 surface used by {FluxoraPay}.
interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title FluxoraPay
 * @notice A tiny USDC payment contract. When you pay someone through it, the
 *         transaction is addressed to THIS contract, and the explorer shows a
 *         `PaymentMade` event with payer, recipient, amount and your note.
 *
 * @dev Design:
 *  - Ownerless and immutable: no admin, no fees, no pause, no upgrade path.
 *  - Never holds funds: USDC moves straight from the payer to the recipient.
 *  - The payer must first approve this contract to spend their USDC:
 *    `USDC.approve(<this contract>, amount)`.
 *  - The token (USDC) is fixed at deploy time. On Arc, USDC has 6 decimals,
 *    so 1 USDC is `1_000_000`.
 *  - Notes (`memo`) are public onchain data. Do not put secrets in them.
 *  - If USDC blocks the payer or recipient, the payment reverts and nothing
 *    is recorded.
 *  - No native-currency path: sending native coin to this contract reverts.
 *  - UNAUDITED. Test on a testnet before using real funds.
 */
contract FluxoraPay {
    // ---------------------------------------------------------------------
    // Constants and storage
    // ---------------------------------------------------------------------

    /// @notice Longest allowed note, in bytes.
    uint256 public constant MAX_MEMO_BYTES = 140;

    /// @notice The payment token (USDC), fixed at deploy time.
    address public immutable usdc;

    /// @notice Number of payments made so far. Payment ids start at 1.
    uint256 public paymentCount;

    /// @notice One recorded payment.
    /// @param payer Account that paid.
    /// @param recipient Account that received the USDC.
    /// @param amount Amount in token units (USDC has 6 decimals).
    /// @param timestamp Block time of the payment.
    /// @param memo Public note supplied by the payer.
    struct Payment {
        address payer;
        address recipient;
        uint256 amount;
        uint64 timestamp;
        string memo;
    }

    mapping(uint256 id => Payment) private _payments;

    uint256 private _lock = 1;

    // ---------------------------------------------------------------------
    // Errors and events
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error NotAContract(address token);
    error InvalidRecipient(address recipient);
    error ZeroAmount();
    error MemoTooLong(uint256 length, uint256 maximum);
    error TransferFailed();
    error UnknownPayment(uint256 id);
    error Reentrancy();

    /// @notice Emitted for every payment made through this contract.
    event PaymentMade(
        uint256 indexed id, address indexed payer, address indexed recipient, uint256 amount, string memo
    );

    // ---------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------

    /// @param usdc_ Address of the USDC token contract on this chain.
    constructor(address usdc_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        if (usdc_.code.length == 0) revert NotAContract(usdc_);
        usdc = usdc_;
    }

    // ---------------------------------------------------------------------
    // Payments
    // ---------------------------------------------------------------------

    /// @notice Pay `amount` USDC from you to `recipient`. Requires a prior approval.
    /// @param recipient Who receives the USDC. Not zero, not you, not this contract.
    /// @param amount Amount in token units (6 decimals). Must be above zero.
    /// @param memo Optional public note, up to {MAX_MEMO_BYTES} bytes.
    /// @return id The id of the recorded payment.
    function pay(address recipient, uint256 amount, string calldata memo) external returns (uint256 id) {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;

        if (recipient == address(0) || recipient == address(this) || recipient == msg.sender) {
            revert InvalidRecipient(recipient);
        }
        if (amount == 0) revert ZeroAmount();
        uint256 memoLength = bytes(memo).length;
        if (memoLength > MAX_MEMO_BYTES) revert MemoTooLong(memoLength, MAX_MEMO_BYTES);

        // Effects: record the payment before moving any tokens.
        id = ++paymentCount;
        _payments[id] = Payment({
            payer: msg.sender,
            recipient: recipient,
            amount: amount,
            timestamp: uint64(block.timestamp),
            memo: memo
        });
        emit PaymentMade(id, msg.sender, recipient, amount, memo);

        // Interaction: USDC goes straight from the payer to the recipient.
        _pull(msg.sender, recipient, amount);

        _lock = 1;
    }

    /// @notice Read one recorded payment.
    /// @param id Payment id, from 1 to {paymentCount}.
    function getPayment(uint256 id) external view returns (Payment memory) {
        if (id == 0 || id > paymentCount) revert UnknownPayment(id);
        return _payments[id];
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /// @dev `transferFrom` that accepts tokens returning `true` or nothing.
    function _pull(address from, address to, uint256 amount) private {
        // A call to an address without code "succeeds" with no data, so check the token still exists.
        if (usdc.code.length == 0) revert NotAContract(usdc);
        (bool ok, bytes memory ret) = usdc.call(abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
        if (!ok || (ret.length != 0 && (ret.length != 32 || abi.decode(ret, (uint256)) != 1))) {
            revert TransferFailed();
        }
    }
}
