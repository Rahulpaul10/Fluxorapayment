// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FluxoraPay} from "../FluxoraPay.sol";
import {FPBehaviorToken, FPHostileRecipient, FPHandler} from "./helpers/FluxoraPayMocks.sol";

contract FluxoraPayTest is Test {
    FluxoraPay internal pay;
    FPBehaviorToken internal token;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant BAL = 1_000e6;

    function setUp() public virtual {
        token = new FPBehaviorToken();
        pay = new FluxoraPay(address(token));
        token.mint(alice, BAL);
        vm.prank(alice);
        token.approve(address(pay), type(uint256).max);
    }

    // ---------------------------------------------------------------- helpers
    function _pay(address from, address to, uint256 amt, string memory memo) internal returns (uint256 id) {
        vm.prank(from);
        id = pay.pay(to, amt, memo);
    }

    function _memo(uint256 len) internal pure returns (string memory) {
        bytes memory b = new bytes(len);
        for (uint256 i; i < len; ++i) b[i] = "a";
        return string(b);
    }

    function _expectNothingRecorded() internal view {
        assertEq(pay.paymentCount(), 0, "count changed");
        vm.assertEq(token.balanceOf(address(pay)), 0);
    }

    // ------------------------------------------------------------ constructor
    function test_Constructor_StoresToken() public view {
        assertEq(pay.usdc(), address(token));
        assertEq(pay.paymentCount(), 0);
        assertEq(pay.MAX_MEMO_BYTES(), 140);
    }

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(FluxoraPay.ZeroAddress.selector);
        new FluxoraPay(address(0));
    }

    function test_Constructor_RevertsOnEOA() public {
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.NotAContract.selector, bob));
        new FluxoraPay(bob);
    }

    // -------------------------------------------------------------- happy path
    function test_Pay_MovesFundsAndContractHoldsNothing() public {
        uint256 id = _pay(alice, bob, 250e6, "rent");
        assertEq(id, 1);
        assertEq(token.balanceOf(alice), BAL - 250e6);
        assertEq(token.balanceOf(bob), 250e6);
        assertEq(token.balanceOf(address(pay)), 0);
        assertEq(pay.paymentCount(), 1);
    }

    function test_Pay_RecordsAllFields() public {
        vm.warp(1_700_000_000);
        uint256 id = _pay(alice, bob, 42e6, "hello");
        FluxoraPay.Payment memory p = pay.getPayment(id);
        assertEq(p.payer, alice);
        assertEq(p.recipient, bob);
        assertEq(p.amount, 42e6);
        assertEq(uint256(p.timestamp), 1_700_000_000);
        assertEq(p.memo, "hello");
    }

    function test_Pay_EmitsPaymentMade() public {
        vm.expectEmit(true, true, true, true, address(pay));
        emit FluxoraPay.PaymentMade(1, alice, bob, 7e6, "invoice #1");
        _pay(alice, bob, 7e6, "invoice #1");
    }

    function test_Pay_IdsAreSequentialFromOne() public {
        token.mint(bob, BAL);
        vm.prank(bob);
        token.approve(address(pay), type(uint256).max);
        assertEq(_pay(alice, bob, 1, ""), 1);
        assertEq(_pay(bob, carol, 1, ""), 2);
        assertEq(_pay(alice, carol, 1, ""), 3);
        assertEq(pay.paymentCount(), 3);
        assertEq(pay.getPayment(2).payer, bob);
        assertEq(pay.getPayment(3).recipient, carol);
    }

    function test_Pay_AllowsContractRecipient() public {
        FPHostileRecipient r = new FPHostileRecipient(address(pay));
        _pay(alice, address(r), 5e6, "to contract");
        assertEq(token.balanceOf(address(r)), 5e6);
    }

    function test_Pay_EmptyMemoOk() public {
        uint256 id = _pay(alice, bob, 1, "");
        assertEq(pay.getPayment(id).memo, "");
    }

    function test_Pay_Memo140BytesOk() public {
        uint256 id = _pay(alice, bob, 1, _memo(140));
        assertEq(bytes(pay.getPayment(id).memo).length, 140);
    }

    function test_Pay_Memo141BytesReverts() public {
        string memory m = _memo(141);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.MemoTooLong.selector, 141, 140));
        pay.pay(bob, 1, m);
        _expectNothingRecorded();
    }

    function test_Pay_MultibyteMemoCountsBytesNotChars() public {
        // "é" is 2 bytes: 70 chars == 140 bytes (ok), 71 chars == 142 bytes (revert).
        bytes memory ok;
        for (uint256 i; i < 70; ++i) ok = bytes.concat(ok, bytes("\xc3\xa9"));
        assertEq(ok.length, 140);
        _pay(alice, bob, 1, string(ok));

        bytes memory tooLong = bytes.concat(ok, bytes("\xc3\xa9"));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.MemoTooLong.selector, 142, 140));
        pay.pay(bob, 1, string(tooLong));

        // 35 four-byte emoji == 140 bytes ok; 36 == 144 reverts
        bytes memory e;
        for (uint256 i; i < 35; ++i) e = bytes.concat(e, bytes(unicode"😀"));
        assertEq(e.length, 140);
        _pay(alice, bob, 1, string(e));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.MemoTooLong.selector, 144, 140));
        pay.pay(bob, 1, string(bytes.concat(e, bytes(unicode"😀"))));
        assertEq(pay.paymentCount(), 2);
    }

    // ---------------------------------------------------------------- reverts
    function test_Revert_ZeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.InvalidRecipient.selector, address(0)));
        pay.pay(address(0), 1, "");
        _expectNothingRecorded();
    }

    function test_Revert_SelfRecipient() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.InvalidRecipient.selector, alice));
        pay.pay(alice, 1, "");
        _expectNothingRecorded();
    }

    function test_Revert_ContractRecipient() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.InvalidRecipient.selector, address(pay)));
        pay.pay(address(pay), 1, "");
        _expectNothingRecorded();
    }

    function test_Revert_ZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.ZeroAmount.selector);
        pay.pay(bob, 0, "");
        _expectNothingRecorded();
    }

    function test_Revert_NoAllowance() public {
        token.mint(bob, BAL); // bob never approved
        vm.prank(bob);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(carol, 1e6, "");
        _expectNothingRecorded();
        assertEq(token.balanceOf(bob), BAL);
    }

    function test_Revert_InsufficientBalance() public {
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, BAL + 1, "");
        _expectNothingRecorded();
        assertEq(token.balanceOf(alice), BAL);
    }

    function test_Revert_TokenReturnsFalse() public {
        token.setMode(FPBehaviorToken.Mode.FALSE);
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, 1e6, "");
        _expectNothingRecorded();
    }

    function test_Revert_TokenReturnsTwo() public {
        token.setMode(FPBehaviorToken.Mode.TWO);
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, 1e6, "");
        _expectNothingRecorded();
        assertEq(token.balanceOf(alice), BAL, "token move must be rolled back");
        assertEq(token.balanceOf(bob), 0);
    }

    function test_Revert_TokenReturnsShortData() public {
        token.setMode(FPBehaviorToken.Mode.SHORT);
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, 1e6, "");
        _expectNothingRecorded();
    }

    function test_Revert_TokenItselfReverts() public {
        token.setMode(FPBehaviorToken.Mode.REVERT);
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, 1e6, "");
        _expectNothingRecorded();
    }

    function test_Revert_FailedPayConsumesNoId() public {
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, BAL + 1, "boom");
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.UnknownPayment.selector, 1));
        pay.getPayment(1);
        assertEq(_pay(alice, bob, 1e6, "ok"), 1, "next payment must still get id 1");
        assertEq(pay.getPayment(1).memo, "ok");
    }

    function test_Revert_PayerBlocklisted() public {
        token.setBlocked(alice, true);
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, 1e6, "x");
        _expectNothingRecorded();
        assertEq(token.balanceOf(alice), BAL);
    }

    function test_Revert_RecipientBlocklisted() public {
        token.setBlocked(bob, true);
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, 1e6, "x");
        _expectNothingRecorded();
        assertEq(token.balanceOf(alice), BAL);
        // unblocking restores service and id starts at 1
        token.setBlocked(bob, false);
        assertEq(_pay(alice, bob, 1e6, "x"), 1);
    }

    // ------------------------------------------------------------ getPayment
    function test_GetPayment_UnknownIds() public {
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.UnknownPayment.selector, 0));
        pay.getPayment(0);
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.UnknownPayment.selector, 1));
        pay.getPayment(1);
        _pay(alice, bob, 1, "");
        pay.getPayment(1);
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.UnknownPayment.selector, 2));
        pay.getPayment(2);
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.UnknownPayment.selector, type(uint256).max));
        pay.getPayment(type(uint256).max);
    }

    // ------------------------------------------------------- token behaviours
    function test_Token_NoReturnData_USDTStyleSucceeds() public {
        token.setMode(FPBehaviorToken.Mode.NODATA);
        assertEq(_pay(alice, bob, 100e6, "usdt"), 1);
        assertEq(token.balanceOf(bob), 100e6);
        assertEq(token.balanceOf(alice), BAL - 100e6);
    }

    function test_Token_FeeOnTransfer_RecordsNominalAmount() public {
        token.setMode(FPBehaviorToken.Mode.FEE);
        uint256 id = _pay(alice, bob, 100e6, "fee");
        // Payer is debited the full amount; recipient gets 1% less; contract still holds 0.
        assertEq(token.balanceOf(alice), BAL - 100e6);
        assertEq(token.balanceOf(bob), 99e6);
        assertEq(token.balanceOf(address(pay)), 0);
        // The record/event carry the NOMINAL amount, not the amount actually received.
        assertEq(pay.getPayment(id).amount, 100e6);
    }

    /// REGRESSION: a low-level call to an address without code "succeeds" with no return data.
    /// pay() must therefore refuse to record a payment if the token has lost its code.
    function test_Regression_TokenCodeRemoved_PayReverts() public {
        bytes memory code = address(token).code;
        vm.etch(address(token), "");
        assertEq(address(token).code.length, 0);

        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.NotAContract.selector, address(token)));
        vm.prank(alice);
        pay.pay(bob, 100e6, "ghost");
        assertEq(pay.paymentCount(), 0, "nothing recorded");

        // restore code (storage is untouched): the same payment now works and moves funds
        vm.etch(address(token), code);
        uint256 id = _pay(alice, bob, 100e6, "real");
        assertEq(id, 1);
        assertEq(token.balanceOf(bob), 100e6);
    }

    // ------------------------------------------------------------- reentrancy
    function test_Reentrancy_BlockedAndLockResets() public {
        token.armReentrancy(address(pay), carol, false);
        uint256 id = _pay(alice, bob, 10e6, "outer");
        assertEq(id, 1);
        assertTrue(token.reenterAttempted());
        assertFalse(token.reenterSucceeded());
        assertEq(bytes4(token.reenterReason()), FluxoraPay.Reentrancy.selector);
        assertEq(pay.paymentCount(), 1, "nested pay recorded nothing");
        assertEq(token.balanceOf(carol), 0);
        // lock reset afterwards
        assertEq(_pay(alice, bob, 1e6, "later"), 2);
    }

    function test_Reentrancy_BubbledRevertFailsWholePayment() public {
        token.armReentrancy(address(pay), carol, true);
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, 10e6, "outer");
        _expectNothingRecorded();
        assertEq(token.balanceOf(alice), BAL);
        // lock not stuck after the reverted call (the token's one-shot arming was rolled back too, so disarm)
        token.armReentrancy(address(0), address(0), false);
        assertEq(_pay(alice, bob, 1e6, "later"), 1);
    }

    function test_Reentrancy_LockResetAfterRevertedPay() public {
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, BAL + 1, "");
        assertEq(_pay(alice, bob, 1e6, "ok"), 1);
        // also after an early (pre-transfer) revert
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.ZeroAmount.selector);
        pay.pay(bob, 0, "");
        assertEq(_pay(alice, bob, 1e6, "ok2"), 2);
    }

    function test_Reentrancy_ViaRecipientImpossible() public {
        FPHostileRecipient r = new FPHostileRecipient(address(pay));
        _pay(alice, address(r), 5e6, "to hostile");
        assertEq(r.callbacks(), 0, "token transfers never call the recipient");
        assertEq(pay.paymentCount(), 1);
    }

    // ----------------------------------------------------------------- native
    function test_Native_PlainSendReverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(pay).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(pay).balance, 0);
    }

    function test_Native_SendWithDataReverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(pay).call{value: 1 ether}(hex"deadbeef");
        assertFalse(ok);
        (bool ok2,) = address(pay).call(hex"deadbeef");
        assertFalse(ok2);
        assertEq(address(pay).balance, 0);
    }

    function test_Native_PayIsNotPayable() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(pay).call{value: 1}(abi.encodeCall(FluxoraPay.pay, (bob, 1e6, "")));
        assertFalse(ok);
        assertEq(address(pay).balance, 0);
        assertEq(pay.paymentCount(), 0);
    }

    // ------------------------------------------------------------------- fuzz
    function testFuzz_Pay_ConservesBalances(address recipient, uint256 amount, uint256 memoLen) public {
        vm.assume(recipient > address(0x100) && recipient != alice && recipient != address(pay));
        vm.assume(recipient != address(token));
        amount = bound(amount, 1, BAL);
        memoLen = bound(memoLen, 0, 140);
        uint256 id = _pay(alice, recipient, amount, _memo(memoLen));
        assertEq(id, 1);
        assertEq(token.balanceOf(alice), BAL - amount);
        assertEq(token.balanceOf(recipient), amount);
        assertEq(token.balanceOf(address(pay)), 0);
        FluxoraPay.Payment memory p = pay.getPayment(1);
        assertEq(p.recipient, recipient);
        assertEq(p.amount, amount);
        assertEq(bytes(p.memo).length, memoLen);
    }

    function testFuzz_MemoLengthBoundary(uint256 memoLen) public {
        memoLen = bound(memoLen, 0, 400);
        string memory m = _memo(memoLen);
        vm.prank(alice);
        if (memoLen > 140) {
            vm.expectRevert(abi.encodeWithSelector(FluxoraPay.MemoTooLong.selector, memoLen, 140));
            pay.pay(bob, 1, m);
            assertEq(pay.paymentCount(), 0);
        } else {
            pay.pay(bob, 1, m);
            assertEq(pay.paymentCount(), 1);
        }
    }

    function testFuzz_InsufficientBalanceAlwaysReverts(uint256 amount) public {
        amount = bound(amount, BAL + 1, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(FluxoraPay.TransferFailed.selector);
        pay.pay(bob, amount, "");
        assertEq(pay.paymentCount(), 0);
    }
}

contract FluxoraPayInvariantTest is Test {
    FluxoraPay internal pay;
    FPBehaviorToken internal token;
    FPHandler internal handler;

    function setUp() public {
        token = new FPBehaviorToken();
        pay = new FluxoraPay(address(token));
        handler = new FPHandler(pay, token);
        targetContract(address(handler));
    }

    function invariant_ContractHoldsNoTokens() public view {
        assertEq(token.balanceOf(address(pay)), 0);
        assertEq(address(pay).balance, 0);
    }

    function invariant_CountMatchesSuccessfulPays() public view {
        assertEq(pay.paymentCount(), handler.ghostCount());
    }

    function invariant_RecordedAmountsSumToTotalMoved() public view {
        uint256 n = pay.paymentCount();
        uint256 sum;
        for (uint256 i = 1; i <= n; ++i) {
            FluxoraPay.Payment memory p = pay.getPayment(i);
            assertGt(p.amount, 0);
            assertTrue(p.payer != p.recipient);
            sum += p.amount;
        }
        assertEq(sum, handler.ghostSum());
        // conservation: tokens only moved between actors
        assertEq(handler.totalActorBalance(), handler.initialTotal());
    }

    function invariant_IdsSequential() public {
        uint256 n = pay.paymentCount();
        if (n > 0) pay.getPayment(n); // last id exists
        vm.expectRevert(abi.encodeWithSelector(FluxoraPay.UnknownPayment.selector, n + 1));
        pay.getPayment(n + 1);
    }
}
