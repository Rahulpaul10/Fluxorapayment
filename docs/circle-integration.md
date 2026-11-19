# Circle integration: audit, verification and plan

Audited against Circle's own documentation pages and the Arc network on 19 Nov 2026. Everything marked "verified" is checked automatically by `bun run test:circle` (it reads Circle's docs and Arc live; it sends nothing).

## What FLUXORA already uses (audit)

| Area | How it is built | Official source |
|---|---|---|
| USDC on Arc | Token `0x3600…0000`, 6 decimals as a token (18 as native gas). One shared definition in the network facts. | Circle USDC contract addresses page |
| Cross-chain | Circle App Kit (`@circle-fin/app-kit`), CCTP **V2** provider, Forwarding Service for the mint. No CCTP V1 code path. | Circle CCTP docs, App Kit |
| Attestation and status | Live steps from the kit (approve, burn, attestation, mint) in Bridge; Bridge history reads Circle's message service (Iris v2) and the destination chain. | Circle Iris API |
| Fees | Forwarding fee from Circle's own fee service, cross-checked against the kit's quote before every bridge. | Circle fee API |
| Payments | `FluxoraPay` / payments contracts moving real USDC; no Circle secret is involved. | n/a |
| Credentials | None. Every Circle endpoint used is public and keyless, so no API key or entity secret exists in the app or its build. A secret would need a server; none is needed. | n/a |

## Verified: Arc is supported by CCTP V2

- Circle's supported-chains page lists **Arc** as a CCTP source (standard transfer, upfront fees) and a Forwarding Service destination. Fast Transfer is "N/A" for Arc because its standard attestation is already fast (1 confirmation, about 0.5 s).
- Domains: Arc **26**, Ethereum **0**. The app and the bridge kit use the same.
- Mainnet contracts, identical on Arc and Ethereum in Circle's table and in the kit: TokenMessengerV2 `0x28b5…cf5d`, MessageTransmitterV2 `0x81D4…4B64`, TokenMinterV2 `0xfd78…D002`, MessageV2 `0xec54…8f78`. All four have code on Arc (chain 5042). Arc's TokenMessengerV2 points at that MessageTransmitterV2, which reports domain 26, and has Ethereum registered.
- The kit's Arc entry has V2 contracts only (no V1). A real recent Arc burn is a V2 message from domain 26 in Circle's attestation service.
- Arc's USDC exposes `isBlacklisted(address)` and `paused()`.

If any of this stopped being true, `test:circle` fails; nothing is simulated.

## Changes made (only verified, officially supported behaviour)

1. **Circle USDC compliance pre-check** (Send, Pay, Bridge from or to Arc). Circle's USDC reverts a transfer to or from a blocklisted address, or while paused, after the wallet has already asked for a signature. The app now reads both flags first, blocks with a plain message, and never claims "clear" when a read fails. For Send through FluxoraPay this also stops an approval being sent for a payment that could not succeed.
2. **Delivery verification** on Send and Pay. After a transaction confirms, the receipt's own Transfer events are read and the page says "Verified in the receipt: X USDC arrived at 0x…" or points out a different amount or a missing transfer. "Confirmed" alone only means the transaction ran.
3. **Estimated arrival** on Bridge now follows the source network's finality from the kit's chain data. An Arc source arrives in seconds on either speed; the old text claimed 15 to 20 minutes for the standard speed on every network, which Circle's finality table does not support for Arc, Avalanche or Polygon.
4. **Attestation state in the Receive step.** While Receive is in progress it says whether it is waiting for Circle's attestation or minting on the destination, taken from the kit's own step reports.

## Not done, on purpose

- No new token, contract or custom CCTP contract; the app calls Circle's deployed V2 contracts through the kit only.
- No Circle Wallets, Gateway or Paymaster: nothing in the existing features needs them, and each would need a server-side secret or a redesign.
- No server and no API key. If Circle features that require a key are added later, the key must stay in a server and never in the build.
- Fast Transfer is not offered for Arc as a source because Circle lists it as not applicable.

## Limits

- The compliance flags are read at the moment of checking; the contract still enforces its own rules at send time.
- `test:circle-ui` replaces the compliance reader and the transaction tracker with test doubles so a blocked address and a confirmed receipt can be shown; real mainnet transfers were not made.
- Real-wallet signing (Rabby, MetaMask, WalletConnect) is not covered by automated tests.
