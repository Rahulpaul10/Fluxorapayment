// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FluxoraPay} from "../../FluxoraPay.sol";

interface IFPPayLike {
    function pay(address recipient, uint256 amount, string calldata memo) external returns (uint256);
}

/// @dev Configurable ERC-20-ish token used to exercise FluxoraPay's return-data handling,
///      blocklist behaviour, fee-on-transfer and reentrancy. Not a production token.
contract FPBehaviorToken {
    enum Mode {
        TRUE, // returns true (standard)
        FALSE, // returns false WITHOUT moving funds
        NODATA, // moves funds, returns no data (USDT style)
        TWO, // moves funds, returns uint256(2)
        SHORT, // moves funds, returns 1 byte
        FEE, // moves funds but the recipient receives 1% less (fee burned)
        REVERT // always reverts
    }

    Mode public mode;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    address public reenterTarget;
    address public reenterRecipient;
    bool public bubble;
    bool public reenterAttempted;
    bool public reenterSucceeded;
    bytes public reenterReason;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function setMode(Mode m) external {
        mode = m;
    }

    function setBlocked(address who, bool b) external {
        blocked[who] = b;
    }

    function armReentrancy(address target, address recipient, bool bubble_) external {
        reenterTarget = target;
        reenterRecipient = recipient;
        bubble = bubble_;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        if (reenterTarget != address(0)) {
            address t = reenterTarget;
            reenterTarget = address(0); // attempt only once
            reenterAttempted = true;
            if (bubble) {
                IFPPayLike(t).pay(reenterRecipient, 1, "re");
                reenterSucceeded = true;
            } else {
                try IFPPayLike(t).pay(reenterRecipient, 1, "re") returns (uint256) {
                    reenterSucceeded = true;
                } catch (bytes memory reason) {
                    reenterReason = reason;
                }
            }
        }
        if (blocked[from] || blocked[to]) revert("blocked");
        Mode m = mode;
        if (m == Mode.REVERT) revert("token reverts");
        if (m == Mode.FALSE) return false;

        require(allowance[from][msg.sender] >= amt, "allowance");
        require(balanceOf[from] >= amt, "balance");
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += (m == Mode.FEE) ? amt - amt / 100 : amt;

        if (m == Mode.NODATA) {
            assembly {
                return(0, 0)
            }
        } else if (m == Mode.TWO) {
            assembly {
                mstore(0, 2)
                return(0, 32)
            }
        } else if (m == Mode.SHORT) {
            assembly {
                mstore(0, 1)
                return(0, 1)
            }
        }
        return true;
    }
}

/// @dev A contract recipient with a hostile fallback; tokens never call it, so it must never run.
contract FPHostileRecipient {
    uint256 public callbacks;
    address public target;

    constructor(address target_) {
        target = target_;
    }

    fallback() external payable {
        callbacks++;
        try IFPPayLike(target).pay(address(0xBEEF), 1, "") {} catch {}
    }
}

/// @dev Invariant handler: bounded pay() calls among a fixed actor set (valid and invalid).
contract FPHandler is Test {
    FluxoraPay public payC;
    FPBehaviorToken public token;
    address[] public actors;
    uint256 public ghostSum;
    uint256 public ghostCount;
    uint256 public initialTotal;

    constructor(FluxoraPay payC_, FPBehaviorToken token_) {
        payC = payC_;
        token = token_;
        for (uint256 i; i < 4; ++i) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(a);
            token.mint(a, 1_000_000e6);
            initialTotal += 1_000_000e6;
            vm.prank(a);
            token.approve(address(payC), type(uint256).max);
        }
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function doPay(uint256 payerSeed, uint256 recipientSeed, uint256 amount, uint256 memoLen) external {
        address payer = actors[payerSeed % actors.length];
        address recipient = actors[recipientSeed % actors.length]; // may equal payer -> reverts
        amount = bound(amount, 0, 300_000e6); // may exceed balance or be zero -> reverts
        memoLen = bound(memoLen, 0, 160); // may exceed 140 -> reverts
        bytes memory m = new bytes(memoLen);
        for (uint256 i; i < memoLen; ++i) m[i] = "x";
        vm.prank(payer);
        try payC.pay(recipient, amount, string(m)) returns (uint256 id) {
            ghostSum += amount;
            ghostCount++;
            require(id == ghostCount, "non-sequential id");
        } catch {}
    }

    function doBadRecipient(uint256 payerSeed, uint256 kind) external {
        address payer = actors[payerSeed % actors.length];
        address bad = kind % 2 == 0 ? address(0) : address(payC);
        vm.prank(payer);
        try payC.pay(bad, 1e6, "") returns (uint256) {
            ghostCount++; // would be a bug; the invariant on paymentCount will catch it
        } catch {}
    }

    function totalActorBalance() external view returns (uint256 t) {
        for (uint256 i; i < actors.length; ++i) t += token.balanceOf(actors[i]);
    }
}
