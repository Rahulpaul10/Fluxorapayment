# Production readiness audit

Scope: the whole FLUXORA app (wallet, send, swap, bridge, pay, history, new analytics, transaction and bridge pages). Method: code review, targeted searches, automated tests against real Arc data with a fake wallet (nothing was signed or sent), and a dependency audit. This is an engineering review, not an independent professional audit, and it does not make the app "production ready" by itself.

## Fixed in this pass

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | Send, Swap, Pay and Request relied on a React `busy` state only. Two quick taps can arrive before the button disables, so a transaction could be submitted twice. | Medium | `useSingleFlight` ignores a second call while one is running (new `src/hooks/useSingleFlight.ts`). Bridge already had this guard. |
| 2 | Explorer links were built by string concatenation without checking the identifier. A malformed value could leak into a URL path. | Low | `explorerTx` and `explorerAddress` accept only a 66-character hash or a 42-character address, URL-encode it, and return `#` otherwise. |
| 3 | An unsupported wallet network only showed a small header badge and a toast. | Low | A persistent banner on every page names the chain, lists supported networks and offers "Switch to Arc". It never switches by itself. Signing was already blocked by the live chain check before every transaction. |
| 4 | History had no status or date filter and no pagination. | Low | Added both (plus search by token, network and saved name), 20 rows per page. |
| 5 | A transfer could be saved as a contact under a name that looked like a recovery phrase or a private key. | Low | The address book refuses input shaped like a private key or a 12-word phrase, checks the checksum of mixed-case addresses, and stores only a name and a public address. |

## Reviewed and found sound

- **Secrets:** no private key, seed phrase or API secret is read, stored or logged by the app. Browser storage holds only public data: activity hashes, saved names and addresses, the theme and the Onchain details switch. The WalletConnect project id is public configuration.
- **Unsafe HTML and links:** no `innerHTML`, `dangerouslySetInnerHTML` or `eval`. Every `target="_blank"` link and `window.open` uses `noopener`.
- **Wallet connection:** connect, disconnect, account change and chain change are handled and tested (`test:wallet`, `test:account`). Before every transaction the live chain and the live account are re-read from the wallet and checked against what the page shows.
- **Decimals:** amounts go through one `Amount` type with exact parsing; extra decimals are rejected, USDC is 6 decimals as a token and 18 as native gas, and conversion happens in one place.
- **RPC failures:** requests retry with backoff and fail over between endpoints. Circle's message service is retried on HTTP 429. Lookups that fail show an error with Retry, never "not found" or "completed".
- **Failed transactions and recovery:** reverts show the real reason; the pending-transaction reconciler marks dropped transactions; Bridge Retry resumes only the failed step and refuses to burn twice.
- **Input validation:** addresses, amounts, notes (140 bytes), slippage and payment-link parameters are validated before use.

## Open items and limits (not fixed, not hidden)

1. **Dependency advisories.** `bun audit` reports 43 advisories (17 high). The high ones are in transitive packages such as `undici`, `@grpc/grpc-js`, `toml-node`, `zod`, `decode-uri-component` and `follow-redirects`, pulled in by wallet and Circle libraries. I did not verify which of these are part of the browser bundle. Review with `bun update` and re-run the tests before upgrading.
2. **Swap fee preview is an upper bound.** It prices a fixed 500,000-gas allowance at the current fee, not an exact estimate, and says "up to". An exact swap estimate needs the approval and permit steps to exist first.
3. **Analytics cover scanned blocks only.** "Transactions sent" is exact (account nonce). Volume, fees and activity counts cover the recent blocks the app has read and say so on the page. Fees come from the last 20 sent transactions with readable receipts.
4. **Bridge history discovery.** Burns that left Arc are found from the TokenMessenger's own events; bridges made in this app from other networks are found from this browser's activity log. Transfers that arrived on Arc from other chains by other means are not discovered. Older burns need "Scan older blocks".
5. **Destination checks need the destination RPC.** Completion is confirmed from the destination transaction receipt or the destination MessageTransmitter's used-nonce flag. If that network's RPC is unreachable the transfer stays "Attested, mint not confirmed".
6. **Rabby simulation error.** The earlier "Simulation Failed: ERC20: transfer amount exceeds balance" in Rabby was not reproduced or resolved. It is not addressed by this pass.
7. **Unaudited contracts.** `Fluxora.sol`, `FluxoraPayments.sol` and `FluxoraPay.sol` have had only automated checks and tests, no independent audit.
8. **Layout.** Mobile and desktop layouts were reviewed in code (no fixed widths that can overflow; long addresses wrap) but not inspected in a real browser by me.

## Needs a real wallet to confirm

Signing and sending in a real wallet (Rabby, MetaMask, WalletConnect), switching networks in the wallet UI, a real bridge end to end on mainnet, real-wallet Retry after a failed burn, and the Rabby simulation behaviour. Automated tests use a fake wallet so no transaction is ever sent.
