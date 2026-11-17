# Bridge: "Burn on source" failure

## What was wrong

The Bridge page let you start a transfer whose amount was not larger than Circle's forwarding fee. Circle's
TokenMessenger refuses that burn, so the transfer stopped after "Approve USDC" with an error on "Burn on source", and
"Estimated receive" showed 0.

- The fee for Arc to Ethereum is currently 1.118159 USDC (Arc Testnet to Ethereum Sepolia: 0.957657 USDC). It is
  taken out of the burned amount.
- The CCTP TokenMessenger on Arc requires `maxFee < amount`. A burn of 0.5 USDC with a 1.2 USDC fee reverts with
  `Max fee must be less than amount` (checked against the Arc mainnet contract with a read-only simulation).
- The page computed "Estimated receive" as `max(0, amount - fee)` and never stopped a transfer where that was 0.

Two more things were found while testing for real on Arc Testnet:

- The fee is quoted before the burn and moves before it is sent: the same route quoted 0.957657 USDC and was charged
  1.080752 USDC two minutes later (+13%). An amount only slightly above the quote can still fail.
- Circle's fee service (`/v2/burn/USDC/fees`) returned HTTP 429 when called repeatedly. The kit retries 10 times, then
  the burn step fails with `Maximum retry attempts (10) exceeded: HTTP 429 - Too Many Requests`. Nothing was burned.

## What the checks in the request found (all correct, nothing to change)

| Item | Value | Verified |
|---|---|---|
| Arc USDC | `0x3600000000000000000000000000000000000000`, 6 decimals | kit config, app config, Arc chain |
| Arc TokenMessenger V2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | wired to MessageTransmitter `0x81D40F21…B64`, domain 26, Ethereum registered as a destination, burn limit 10,000,000 USDC per message |
| Ethereum domain | 0 | kit config, TokenMessenger remote registry |
| Approve | the kit raises the allowance by exactly the burn amount | real transaction, see below |
| Burn amount | 6-decimal units, exact | `src/lib/bridgeMath.ts` |

## What changed

- `src/lib/bridgeMath.ts`: exact fee and receive math. Bridging is allowed from the quoted fee plus 25% headroom.
  Estimated receive is shown only when the amount and every fee are valid, never as 0.
- `src/lib/bridgeErrors.ts`: reads what really happened to a transaction (receipt, and the node's own revert reason for
  a reverted one) and decides whether Retry may run.
- `src/pages/Bridge.tsx`: the Bridge button stays off until the amount is valid; a failed step shows the real reason and
  its hash; one bridge at a time; success is confirmed against the chain; quotes retry with backoff; Retry resumes only
  the failed step, refuses to burn again when the burn may have been mined, and waits longer after each rate limit.

## Real test on Arc Testnet (throwaway wallet, testnet USDC)

Before the fix, an amount below the fee (0.5 USDC, fee 0.957657):

```
approve  success
burn     error   Simulation failed on Arc Testnet: Max fee must be less than amount
```

After the fix, 1.5 USDC (Arc Testnet to Ethereum Sepolia, fast, forwarding on): all four steps succeeded in 26 seconds.

- Approve `0x9a54…0ad2b`: receipt success, allowance raised by exactly 1.500000 USDC.
- Burn `0xf24b…ec9b952`: receipt success.
- Attestation: success.
- Mint on Ethereum Sepolia `0x11bb…6f139` (sent by Circle's forwarder): receipt success. The recipient's Sepolia USDC
  balance went from 0.000000 to 0.419248 (1.5 minus the 1.080752 fee charged at burn time).

## Tests

`bun run test:bridge` (math, failure explanations, Retry gate, CCTP configuration read from the Arc chain),
`bun run test:bridge-ui` (the page with a stand-in for Circle's kit, including the failures seen above).


## Fee verification (follow-up)

The Arc to Ethereum forwarding fee shown in the quote is Circle's own `high` fee tier for that route (the bridge kit reads `forwardFee.high` from Circle's fee service and uses it as the burn's `maxFee`). It is not a number this app invents and it moves with Ethereum gas: 0.76, 0.99 and 1.21 USDC for low, medium and high at one reading, and 1.208146 / 1.199643 USDC at others. The burn is rejected unless the amount is larger than that fee, so a 0.001 USDC transfer can never succeed.

What the app checks before it lets a bridge start:

- the route: both networks are mainnets and their chain ids and CCTP domains (Arc 26, Ethereum 0) agree with the bridge kit's own data;
- the quote: the forwarding fee is a priced, positive USDC amount, no older than a minute, and within a tolerance of Circle's official `high` tier read separately from Circle's fee service;
- the amount: strictly larger than the live fee, with the minimum shown as exactly the fee plus 0.000001 USDC (no added margin);
- again right before the burn: the quote and the official tiers are re-read, and nothing is sent if they no longer agree or the fee has risen above the amount.

If Circle's fee service is unreachable, rate limiting, or returns something unexpected, the bridge stays off and says why. An unusually large fee share is explained, not hidden. Test: `bun run test:cctp-fees` (read only).
