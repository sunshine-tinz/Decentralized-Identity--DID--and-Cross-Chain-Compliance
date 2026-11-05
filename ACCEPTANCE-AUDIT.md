# Open-Source Acceptance Audit

**Repository:** `sunshine-tinz/Decentralized-Identity--DID--and-Cross-Chain-Compliance`
**Commit audited:** `b84474b` (`main`, clean working tree, in sync with `origin/main`)
**Audit date:** 2026-11-04
**Toolchain:** rustc 1.88.0, cargo 1.88.0, node v24.22.2, npm 11.19.1
**Scope:** all 43 tracked files — 3 Soroban contracts, 2 Node services, 1 TypeScript SDK, 1 React frontend, CI workflow, docs.

This is a fresh audit of the current tree. The committed `AUDIT.md` was treated as history only; every claim below comes from reading the code at `b84474b` and from command output produced during this audit.

---

## 1. Executive verdict

**NOT READY for open-source ecosystem approval.** Three independent blockers:

1. **No deployment evidence exists.** There is not a single real Testnet contract ID, transaction hash, or deployment record anywhere in the repository. Every end-to-end path is `BLOCKED`, not "working". (§8)
2. **Two high-severity integrity defects in the shipped code.** A revoked credential can be silently resurrected by any registered issuer (`issue_credential` overwrites the record and resets `revoked`), and the bridge discards attestations permanently when the EVM relay fails because it advances its cursor before the relay completes. Both are demonstrated below, not inferred.
3. **The system is not integrated end to end.** The frontend imports nothing from the SDK and makes no API calls; the KYC service contains zero contract interaction; no EVM receiver contract exists. The advertised user journey cannot run at any layer above unit tests.

**What is genuinely good:** all three contracts compile, lint clean, and pass 41 unit tests; the two services and the SDK pass 56 tests; the KYC service's key handling (reverse-HMAC lookup, constant-time comparison, one-time retrieval tokens, redacted review views) is better than typical prototype work; and the documentation is unusually honest about the ring-proof and EVM gaps. The problem is not sloppiness — it is that the project is a well-built set of components with no wiring and no evidence of running together.

**Recommended disposition:** accept as an educational / reference implementation for Soroban experimentation **after** the P0 remediation in §7 and after Testnet evidence is produced. Do **not** approve it as production software, as a custody or compliance product, as a cross-chain interoperability reference, or as a W3C conformance implementation.

---

## 2. Method and limitations

Performed:

- Static read of every contract, service, SDK module, frontend page, test file, workflow, config and doc.
- Execution of all declared build/test/lint/typecheck commands, with exit codes recorded (§5).
- Dependency audit of all four npm packages with `npm audit --omit=dev`.
- One dynamic reproduction of the bridge cursor defect using the service's own `StellarListener` with an injected RPC stub, run from `/tmp` so that no repository file was modified.
- Repository-wide scans for deployment artifacts, `TODO`/stub markers, SDK imports in the frontend, and contract calls in the services.

Limitations, stated plainly:

- **GitHub Actions status is not observable from this environment.** CI was reproduced locally; whether the hosted workflow is currently green is `NOT VERIFIED`.
- **No Testnet access.** No funded keypair, RPC endpoint, or deployed contract was available. Nothing in this report claims a live call succeeded.
- **No EVM access.** No `AttestationReceiver.sol`, no deployed address, no RPC.
- Findings marked *code-level* were established by reading code and, where noted, by local execution. Findings marked *live-risk* could not be confirmed without a network and are labelled as such rather than asserted.

---

## 3. Findings

Severity bar used: **Critical** = unauthenticated loss of funds or takeover of a deployed system. **High** = a security control that fails in the normal operating path, or a core advertised capability that does not exist. **Medium** = a real defect with a precondition or limited blast radius. **Low** = hygiene, robustness, or documentation accuracy.

No finding reached the Critical bar, because nothing is deployed and no contract holds value. That is a statement about the current state, not a clean bill of health: H-1 and H-2 become Critical the moment this code is deployed with real credentials.

### High

**H-1 — Any registered issuer can resurrect a revoked credential, and can overwrite another issuer's credential.**
`contracts/vc_verifier/src/lib.rs`, `VCVerifier::issue_credential` (line 300), key derivation `VCVerifier::cred_key` (line 433).

The storage key is `(subject, attribute)` with no issuer component, and `issue_credential` performs **no check for an existing record**: it constructs `Credential { …, revoked: false, … }` and calls `persistent().set(&key, &credential)` unconditionally (lines 315–330).

Two consequences, both reachable by anyone in the issuer registry:

- Issuer A issues a credential for a subject; the admin or issuer B revokes it; issuer A (or any issuer C) calls `issue_credential` again for the same `(subject, attribute)` and the revocation is erased. There is no tombstone, no revocation epoch, and no admin-only path for re-issuance.
- Issuer A can replace issuer B's attestation for the same attribute with a later `expires_at`, and the record's `issuer` field silently becomes A. Consumers reading `get_credential` cannot tell that the attestation changed hands.

The doc comment (lines 295–299) documents only the two panic conditions that *do* exist (unregistered issuer, non-future expiry) and does not mention overwrite.

**H-2 — The bridge marks events processed and advances its cursor before relaying, so a relay failure loses the attestation permanently.**
`services/cross-chain-bridge/src/lib/stellarListener.js`, `StellarListener::_poll` (lines 74–92); consumer at `services/cross-chain-bridge/src/index.js` line 53.

`_poll` pushes the event id into `_processedIds` (line 84) and calls `this.emit("attestation", parsed)` (line 88) without awaiting the handler, then calls `this._saveState()` (line 92), persisting the advanced cursor. The handler registered in `index.js` is `async` and swallows relay errors in a `try/catch` (lines 53–60), so a failed EVM transaction leaves the state file saying "already handled" with the cursor past the event.

Reproduction with an injected RPC stub returning one event, and a handler that rejects after 50 ms:

```
handler invocations: (not awaited)
cursor AFTER poll returns: "cursor-after-event"
event marked processed: true
--- after the async handler rejected ---
event still marked processed: true
```

Because the handler's promise is not awaited, the rejection is also unhandled at the `EventEmitter` level — in the reproduction the Node process terminated with `Error: relay failed`. The production handler catches internally, which converts that crash into the quieter and worse outcome: the attestation is dropped with no error surfaced to any queue, and `_processedIds` (capped at 500, `MAX_PROCESSED_IDS`) will eventually evict the id so nothing can even be reconstructed.

There is no retry, no dead-letter store, and no idempotency key handed to the destination beyond the derived `nonce`.

**H-3 — The KYC issuer service never writes to the chain, so "issuer approval" produces a credential the contracts have never seen.**
`services/kyc-issuer/src/` (all files); claim at `README.md` line 55.

A repository-wide scan for contract interaction in the service returns nothing:

```
$ grep -rn "Contract\|invoke\|rpc\|RPC\|COMPLIANCE_ENGINE\|VC_VERIFIER" services/kyc-issuer/src
(none)
```

The service has no `@stellar/stellar-sdk` dependency. `routes/issuer.js` computes a credential object in memory (line 94) and stores it under a retrieval token. `services/kyc-issuer/.env.example` gates that behind a placeholder mode that is off by default, and returns `501` otherwise (line 70) — correctly fail-closed, but the consequence is that **no configuration of this service can produce an on-chain credential.**

`README.md` line 55 states the credential is "recorded on-chain via `VCVerifier.issue_credential` with an explicit expiry." That is false for the current code and is the single most consequential documentation defect in the repository, because it describes the integration that the whole project is named after.

**H-4 — The frontend is not connected to anything.**
`frontend/src/pages/*.tsx`; dependency declared at `frontend/package.json` (`@stellar-did/sdk: file:../sdk`).

```
$ grep -rn "@stellar-did/sdk" frontend/src
NO imports of the SDK in frontend/src
```

Four pages render static copy and local form state. There is no SDK call, no `fetch`, no contract read, no wallet connection. The `ProvePage` in particular presents a "prove without revealing" flow that has no implementation behind it — the ring-signature primitive it would call is not implemented at all (M-9).

**H-5 — Credential and DID storage is extended to roughly 24 hours and then archives, because simulated reads do not persist TTL bumps.**
`contracts/vc_verifier/src/lib.rs` line 90 (`TTL_EXTEND_TO: u32 = 17_280`), `contracts/did_registry/src/lib.rs` (same constant, bump at line 194 inside `resolve`).

17,280 ledgers at the current 5-second close time is ~24 hours. `resolve` and `get_credential` extending TTL only matters when a *transaction* is submitted; the SDK's read path is `simulateRead` (`sdk/src/lib/soroban.ts` line 59), which by definition does not. A DID registered and then only ever read through the SDK, or a credential that nobody re-issues within a day, will let its persistent entry expire.

For Soroban, expiry of a persistent entry is archival: `resolve` then needs a restore operation before it works again, and `get_credential` panics with `"credential not found"` — which `is_credential_valid` (line 389) converts into `false`, i.e. a compliance check fails because of a storage TTL, with no distinguishable error. `docs/architecture.md` describes the behaviour as "Persistent entries are TTL-extended on write and on resolve", which is true of the code and misleading about the outcome.

### Medium

**M-1 — `is_compliant` traps when the configured verifier address is not a contract, contradicting its documented contract.**
`contracts/compliance_engine/src/lib.rs`, `ComplianceEngine::is_compliant` (line 212) and `ComplianceEngine::credential_is_valid` (line 282, call at line 293).

The doc comment (lines 206–210) promises "Returns `false` — never panics — when … any required credential is missing, expired, revoked, or from a de-registered issuer." The internal call is `env.invoke_contract::<bool>(...)`, which traps if the verifier address is wrong, if the verifier was upgraded away, or if the invocation exceeds its budget. `invoke_contract` propagates a panic from the callee, and `VCVerifier::get_credential` panics on a missing key (`expect("credential not found")`, line 382) — so a *missing credential* is one of the documented `false` cases and is in fact a panic path.

This matters because `is_compliant` is the function third parties integrate against, and it is called by `export_attestation` (line 246), which turns the trap into a failed attestation.

**M-2 — Any registered issuer can revoke any other issuer's credential.**
`contracts/vc_verifier/src/lib.rs`, `VCVerifier::revoke_credential` (line 347).

The authorization check is `is_registered_issuer(&caller) || caller == admin` with no comparison against `credential.issuer`. The behaviour is documented, so it is deliberate rather than accidental, but it means permission to attest implies permission to deny — a single compromised or malicious issuer in a multi-issuer registry can revoke the entire registry's credentials. Combined with H-1 it is worse: the revocation can then be reverted by the same party.

**M-3 — The EVM relayer signs with `chainId = 0` when it cannot read the network, instead of failing closed.**
`services/cross-chain-bridge/src/lib/evmRelayer.js` lines 89–90.

```js
const network = await this.contract.runner?.provider?.getNetwork?.();
const chainId = network?.chainId ?? 0;
```

Every optional-chaining step can yield `undefined`, and the fallback is a valid-looking `0`. A signature over chain id 0 is either rejected at the destination or, if the destination omits chain-id validation, replayable across chains. The relayer already throws on a reverted receipt (line 110) — the same discipline is missing here.

**M-4 — The event filter is one topic position wide, not two, so it matches any event whose first topic is `compliance`.**
`services/cross-chain-bridge/src/lib/stellarListener.js` line 111: `topics: [[toScValString(TOPIC_NAMESPACE), toScValString(TOPIC_ATTESTATION)]]`.

In `@stellar/stellar-sdk`, `topics` is an array of *positions*, each position an array of acceptable values — the SDK's own documentation in `lib/rpc/server.d.ts` shows `[[ "*" ], [ "*", "…" ]]` for two positions and `[[ "…" ]]` for one. The correct filter is `[[namespace], [attestation]]`. As written the filter over-matches; `_parseEvent` then drops non-attestation events, so integrity is preserved, but the bug hides filter-drift and burns RPC budget. Confirmed by reading the installed SDK's type documentation, not by a live query.

**M-5 — The KYC rate limiter buckets every client together behind a proxy, and request memory is retained without bound.**
`services/kyc-issuer/src/lib/rateLimit.js` (line 17), `services/kyc-issuer/src/index.js` (lines 49, 54), `services/kyc-issuer/src/store.js` (lines 23).

No `app.set("trust proxy", …)` is configured, so `req.ip` is the proxy's address and all submissions share one 30/min bucket — the limiter is simultaneously a denial-of-service vector against legitimate users and no protection at all per client once proxied. The body limit is 6 MB (`express.json({ limit: "6mb" })`) and each accepted request retains a personal-info blob plus a base64 document photo in `store.requests` for the process lifetime; `store.issuedCredentials` entries are only deleted on retrieval (line 88 of `routes/kyc.js`), so never-fetched credentials are retained forever, and the retrieval token itself has no expiry.

**M-6 — Two high-severity transitive advisories in every package.**
`npm audit --omit=dev` in all four packages reports `toml` (GHSA-82x6-q7mm-w9cf uncontrolled recursion; GHSA-v5mp-jgw5-2x6j prototype pollution; three quadratic-complexity DoS) reached through `@stellar/stellar-sdk`. `services/kyc-issuer` additionally reports `qs`/`express` moderate advisories (GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw), which are fixable in-range; `frontend` reports two `react-router` moderates requiring a major upgrade.

Reachability, as observed: no file in the repository calls the TOML parser or the `StellarToml` resolver, and no request parameter reaches `qs` parsing in a way the advisories describe. So these are not currently exploitable through this code — but they are published advisories on shipped dependencies, they are `high`, and an open-source consumer cannot be expected to perform that analysis themselves.

**M-7 — The project is licensed MIT in prose but ships no licence, and no package declares one.**
No `LICENSE` file. `README.md` says MIT. `grep '"license"' */package.json` → nothing; `contracts/*/Cargo.toml` contains no `license` or `authors` field.

For an ecosystem-approval decision this is disqualifying on its own: downstream users have no grant of rights, and package registries and corporate policy scanners will flag the SDK and contracts as unlicensed.

**M-8 — SDK reads use a hard-coded source account that cannot exist, so they are unlikely to work against a real RPC.**
`sdk/src/lib/soroban.ts` lines 23 and 66.

```ts
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const source = new Account(config.publicKey ?? SIMULATION_SOURCE, "0");
```

Simulation requires the source account to exist with a valid sequence number; `GAAAA…WHF` is the all-zeros StrKey placeholder. Every unit test injects a stub `server`, so this path is exercised only against mocks. **Code-level finding; live behaviour `BLOCKED`** — I could not confirm it fails against Testnet, and I will not claim it does. The risk is that the SDK's headline read feature is untested on a network.

### Low

- **L-1** `routes/issuer.js` line 70 returns `501` (placeholder issuance disabled) before evaluating `404`/`403` for the request id, so the response leaks nothing but returns a misleading status for unknown ids. Ordering should be 404 → 403 → 501.
- **L-2** `frontend/package.json` declares `"test": "vitest"` with zero test files; `npm test` exits **1** ("No test files found"). The command is documented as available and is not run in CI, so it fails silently for contributors.
- **L-3** `.github/workflows/ci.yml` uses `dtolnay/rust-toolchain@master` — an unpinned action on a mutable branch, a supply-chain risk in the one place that has repository write access.
- **L-4** No `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, or `.github/dependabot.yml`. Ecosystem review checklists expect at least a vulnerability-disclosure route.
- **L-5** CI has no dependency-audit job and no frontend-test job, so M-6 and L-2 cannot be caught mechanically.
- **L-6** `export_attestation` publishes an event on every call and any caller can invoke it, so attestation events (and thus bridge traffic) can be generated at will for any subject and policy. The function is documented as unsigned, and consumers are warned to re-evaluate, so this is spam rather than forgery — but it is an unauthenticated write-amplification channel.
- **L-7** `ComplianceClient.getPolicy` throws on a missing policy while other reads return typed values; inconsistency forces callers to special-case a normal "not configured" state.
- **L-8** Attestations carry `evaluated_at` but nothing downstream enforces freshness: the relayer signs it, and there is no destination code to check it (the destination does not exist).
- **L-9** 29 `TODO`/stub markers remain across source and docs. They are honest, but they are the inventory of the gaps above rather than a plan.

### Ring signatures and privacy — status, not a finding

`VCVerifier::verify_credential` (line 252) is present, and the ring-key storage path (`ring_key`, line 237) exists, but there is **no ring-signature implementation anywhere in the repository**: no challenge/hash-to-scalar derivation, no key-image or nullifier, no proof serialization, no verifier equation. Verification is disabled by construction. `README.md` and `docs/architecture.md` say so explicitly, which is to the project's credit.

Privacy consequence: the current system is **pseudonymous at best**. Every credential is a public `(subject_address, attribute, issuer, expiry)` tuple in persistent storage, readable by anyone, and `is_compliant` is an unauthenticated read. There is no anonymity set, no selective disclosure, and no unlinkability. Any published claim of privacy-preserving proof must be read as "not implemented".

### Replay protection — status

A repository-wide scan for `nonce|nullifier|domain|replay` across `contracts/*/src` returns **nothing**. Protection rests entirely on `issued_at`/`expires_at` ledger windows in `verify_credential`, which is disabled. On the bridge, `evmRelayer` derives a `nonce` and includes `chainId` in the signed payload (line 95) — sound in shape, defeated by M-3's `?? 0` fallback, and unverifiable without a receiver contract that would enforce it.

---

## 4. Feature status

Legend: **PASS** = exercised and green during this audit. **FAIL** = implemented but wrong/absent where the feature is claimed. **BLOCKED** = cannot be verified without a network/deployment. **NOT TESTED** = exists, no test covers it, no live path attempted.

| # | Feature | Status | Basis |
|---|---|---|---|
| 1 | DID register / update / deactivate (contract) | **PASS** | 10 unit tests, `cargo test` exit 0 |
| 2 | DID resolve (contract) | **PASS** | unit tests; TTL caveat H-5 |
| 3 | DID registration on Testnet | **BLOCKED** | no deployed contract, no keys |
| 4 | DID key rotation / recovery | **FAIL** | only a `document_hash` update exists; no key management |
| 5 | Issuer registry + `require_auth` | **PASS** | unit tests |
| 6 | Credential issuance (contract) | **PASS** | 20 vc_verifier tests; but H-1 overwrite defect |
| 7 | Credential issuance via KYC service → chain | **FAIL** | H-3, zero contract interaction in service |
| 8 | Credential validity check / expiry | **PASS** | unit tests |
| 9 | Credential revocation | **PASS** (semantics) | unit tests; bypassable via H-1, over-broad via M-2 |
| 10 | Issuer authorization (contract) | **PASS** | unit tests |
| 11 | Issuer authorization (service ↔ chain) | **FAIL** | service trusts its own env map, never consults the registry |
| 12 | Ring-signature proof generation | **FAIL** | not implemented |
| 13 | Ring-signature verification (on-chain) | **FAIL** | disabled by design, documented |
| 14 | Replay protection for proofs | **NOT TESTED** | no scheme exists to test |
| 15 | Policy configuration (`set_policy`) | **PASS** | 11 compliance tests |
| 16 | Compliance evaluation (cross-contract) | **PASS** | unit tests; panic caveat M-1 |
| 17 | Compliance evaluation on Testnet | **BLOCKED** | no deployment |
| 18 | Attestation export | **PASS** | unit tests; spam caveat L-6 |
| 19 | Bridge: event parsing | **PASS** | 12 unit tests |
| 20 | Bridge: live event ingestion | **BLOCKED** | no RPC/contract |
| 21 | Bridge: relay to EVM | **FAIL** | H-2 loses events; M-3 chain id |
| 22 | EVM receiver contract | **FAIL** | does not exist in repo |
| 23 | SDK: read paths | **PASS** (mocked) | 13 tests; M-8 live risk |
| 24 | SDK: live reads | **BLOCKED** | no RPC |
| 25 | SDK: transaction building | **PASS** | unit tests; never submitted |
| 26 | SDK: transaction submission | **FAIL** | by design, not implemented |
| 27 | Frontend: typecheck / production build | **PASS** | exit 0 |
| 28 | Frontend: functionality | **FAIL** | H-4, placeholders only |
| 29 | Frontend: tests | **FAIL** | `vitest` exits 1, no test files |
| 30 | CI pipeline definition | **PASS** (static) | jobs match local commands |
| 31 | CI pipeline execution | **NOT VERIFIED** | hosted run not observable here |
| 32 | W3C DID Core conformance | **FAIL** | custom `DIDDocument`, no JSON-LD/`did:stellar` resolution spec |
| 33 | W3C VC Data Model conformance | **FAIL** | bespoke `Credential` struct, no VC-JWT/JSON-LD |
| 34 | SEP-10 / SEP-12 / SEP-45 | **FAIL** | static bearer key auth, no SEP implementation |
| 35 | Testnet deployment evidence | **BLOCKED** | none in repository |

**End-to-end trace (the acceptance question).** Each step of the advertised journey, in order:

| Step | Path | Result |
|---|---|---|
| 1 | Wallet → `DIDRegistry.register` | BLOCKED — no wallet integration, no deployment |
| 2 | Frontend → SDK → `DIDRegistry.resolve` | BLOCKED — frontend imports no SDK (H-4) |
| 3 | Frontend → KYC `POST /api/kyc/request` | BLOCKED — no HTTP client in frontend |
| 4 | Issuer approval → `VCVerifier.issue_credential` | FAIL — never called (H-3) |
| 5 | `VCVerifier.is_credential_valid` for the subject | BLOCKED — no credential ever exists on-chain |
| 6 | `ComplianceEngine.set_policy` / `is_compliant` | BLOCKED — no deployment |
| 7 | `attestation` event → bridge listener | BLOCKED — no contract emitting events |
| 8 | Bridge → `AttestationReceiver` on EVM | FAIL — receiver does not exist; retry loses events (H-2) |

Not one of the eight steps can be executed end to end at this commit.

---

## 5. Build and test evidence

All commands were run in this audit at `b84474b`. Exit codes are literal.

| Command | Exit | Output |
|---|---|---|
| `cargo fmt --all -- --check` | **0** | no diff |
| `cargo clippy --all-targets --all-features -- -D warnings` | **0** | no warnings |
| `cargo test` (workspace) | **0** | **41 passed** — 11 compliance_engine, 10 did_registry, 20 vc_verifier |
| `cargo build --release --target wasm32-unknown-unknown` | **0** | 3 WASM artifacts |
| `cd services/kyc-issuer && npm ci` | **0** | — |
| `cd services/kyc-issuer && npm test` | **0** | **31 passed / 31** |
| `cd services/cross-chain-bridge && npm ci` | **0** | — |
| `cd services/cross-chain-bridge && npm test` | **0** | **12 passed / 12** |
| `cd sdk && npm ci` | **0** | — |
| `cd sdk && npm run build` | **0** | ESM + CJS + d.ts |
| `cd sdk && npm test` | **0** | **13 passed / 13** |
| `cd sdk && npm run lint` | **0** | clean |
| `cd frontend && npm ci` | **0** | — |
| `cd frontend && npm run typecheck` | **0** | clean |
| `cd frontend && npm run build` | **0** | `dist/assets/index-*.js` 167.55 kB |
| `cd frontend && npm test` | **1** | `No test files found, exiting with code 1` |

Totals: **97 automated tests pass** (41 Rust, 31 KYC, 12 bridge, 13 SDK), 1 declared command fails, 0 tests exist for the frontend.

Test-suite caveat worth stating explicitly: the passing tests validate the components *in isolation*. `contracts/*/test_snapshots/` exists on disk but is untracked and git-ignored (`git ls-files` count 0), so CI regenerates snapshots rather than verifying them. And no test crosses a service boundary — there is no test in which the KYC service causes a contract call, and none in which a bridge event reaches an EVM chain.

Dependency audit (`npm audit --omit=dev`), current state:

| Package | Critical | High | Moderate | Detail |
|---|---|---|---|---|
| kyc-issuer | 0 | 2 | 2 | `toml` via `@stellar/stellar-sdk`; `qs`/`express` (in-range fix available) |
| cross-chain-bridge | 0 | 2 | 0 | `toml` via `@stellar/stellar-sdk` |
| sdk | 0 | 2 | 0 | `toml` via `@stellar/stellar-sdk` |
| frontend | 0 | 2 | 2 | `toml`; `react-router` (major upgrade required) |

---

## 6. README / documentation claims not supported by the implementation

The documentation was already revised once (see `AUDIT.md`) and is largely honest. These statements still overstate the code:

| Claim | Location | Reality |
|---|---|---|
| Issuer approval records the credential "on-chain via `VCVerifier.issue_credential`" | `README.md:55` | No contract call exists in the service (H-3). |
| "Persistent entries are TTL-extended on write and on resolve" | `docs/architecture.md` | True of the code, misleading about effect: reads do not persist, so entries archive in ~24 h (H-5). |
| Capability table implies an issuer-attested credential flow is usable | `README.md`, capability table | The only path that creates a credential is a direct contract call; no shipped component performs it. |
| "Unit-tested" for the bridge listener | `README.md`, capability table | Accurate for parsing/signing; the cursor/relay ordering defect (H-2) is not covered by any test. |
| SDK reads "implemented" | `README.md`, capability table | Implemented against an injected server; the default simulation source cannot exist on a real network (M-8, unverified live). |

Correctly and honestly documented (no change needed): ring proofs not implemented; no SEP implementation; no EVM receiver contract in the repository; frontend described as placeholder; no W3C conformance claim.

---

## 7. Required fixes and measurable acceptance criteria

Ordered by priority. Each criterion is testable by someone who was not part of this audit.

### P0 — must be closed before any deployment or ecosystem approval

1. **Fix credential re-issuance (H-1).** `issue_credential` must not overwrite a revoked credential and must not let one issuer replace another issuer's record for the same `(subject, attribute)`.
   *Acceptance:* two regression tests — (a) issue → revoke → re-issue by the same issuer panics; (b) issuer A issues, issuer B issues the same `(subject, attribute)` and panics; `cargo test` green; doc comment lists every panic condition.

2. **Fix bridge durability (H-2).** Relay first; advance `_cursor` and record `_processedIds` only after the handler resolves successfully; await the handler; do not let a handler rejection escape the poll loop.
   *Acceptance:* regression test with a rejecting relayer — cursor unchanged, event absent from `_processedIds`, no unhandled rejection; second poll retries the same event; a subsequent successful relay advances the cursor exactly once. `npm test` green.

3. **Make `is_compliant` honour its contract (M-1).** Use `try_invoke_contract` and map failures to `false`.
   *Acceptance:* unit test where the verifier address is a non-contract address returns `false` instead of trapping; `export_attestation` then returns `compliant: false` rather than aborting.

4. **Fail closed on chain id (M-3).** Throw when `getNetwork()` is unavailable instead of signing with `0`.
   *Acceptance:* test with a runner lacking `provider` asserts a thrown error and no signed payload.

5. **Correct the event filter (M-4).** `topics: [[namespace], [attestation]]`.
   *Acceptance:* assertion on the constructed filter shape in the listener test.

6. **Add the licence (M-7).** `LICENSE` (MIT, matching the README), `"license": "MIT"` in all four `package.json` files, `license = "MIT"` in the Cargo manifests.
   *Acceptance:* `git ls-files LICENSE` non-empty; grep shows the field in every manifest.

7. **Correct the documentation (H-3, H-5).** README step 3 must state that the KYC service does not currently submit to the chain and that no shipped component performs on-chain issuance; architecture must state that simulated reads do not extend TTL.

### P1 — required for a credible ecosystem release

8. **Raise the storage TTL (H-5).** Extend to a configured policy (e.g. 30 days / 518,400 ledgers, well within the network maximum) and document the archive/restore path.
   *Acceptance:* constant change + a test asserting the extend target ≥ the documented policy; `docs/architecture.md` describes archival and restore.

9. **KYC hardening (M-5).** `trust proxy` behind an env flag; per-token expiry on retrieval credentials; bounded retention for never-fetched credentials and for request payloads.
   *Acceptance:* tests for (a) proxied requests using `X-Forwarded-For` when enabled, (b) expired token returns 404, (c) retention bound enforced.

10. **Dependency remediation (M-6).** Update `@stellar/stellar-sdk` to 17.4.0 (or record a written reachability exception), fix `qs`/`express` in kyc-issuer, upgrade `react-router`.
    *Acceptance:* `npm audit --omit=dev` reports 0 high in all four packages, or a checked-in exception document with a date and owner.

11. **Community/security files (L-4).** `SECURITY.md` with a disclosure address, `CODE_OF_CONDUCT.md`, issue/PR templates.

12. **CI hardening (L-3, L-5).** Pin `dtolnay/rust-toolchain` to a commit SHA; add a dependency-audit job and a frontend-test job.
    *Acceptance:* static check — no `@master`/`@main` action refs; both jobs present and green.

13. **Fix the frontend test command (L-2).** Either add tests or make the script exit 0 deliberately.
    *Acceptance:* `npm test` in `frontend` exits 0 and actually runs something, or the script is removed.

### P2 — capability gaps to be stated as gaps, not fixed by relabelling

14. **KYC → contract integration (H-3):** the service must build, sign and submit `issue_credential`, or the flow must be documented as manual.
15. **EVM receiver (H-2/step 8):** a contract with `receiveAttestation`, chain-id validation, nonce/dedup and freshness checks.
16. **Frontend integration (H-4):** at least one page performing a real SDK read against a deployed contract.
17. **Ring signatures (13/14):** a specified, tested proof scheme; until then no privacy claim beyond pseudonymity.
18. **Testnet deployment (35):** published contract IDs and transaction hashes for register → issue → verify → policy → attestation.

---

## 8. Evidence required for open-source approval

Nothing below exists at `b84474b`; each is verifiable by a third party.

- **Deployment record:** the three Testnet contract IDs, the deployment transaction hashes, the ledger of deployment, and the RPC URL used — committed in the repository, not screenshotted.
- **Reproducible E2E script:** one command that registers a DID, issues a credential through the actual issuer path, evaluates a policy, exports an attestation, and prints the transaction hashes; committed and runnable by a reviewer with their own funded account.
- **Bridge evidence:** a real Stellar Testnet event observed by the listener and a corresponding EVM transaction hash on a test network, with the receiver contract source in the repository.
- **Frontend evidence:** at least one page demonstrating a live read, with the network and contract configured in the repository.
- **CI evidence:** a link to a green run of the workflow at the audited commit, including the pinned action SHA.
- **Security closure:** H-1, H-2, M-1, M-3, M-4 fixed with regression tests; dependency audit at 0 high, or a dated exception.
- **Legal/process:** `LICENSE` present and referenced, `SECURITY.md` present, licence fields in manifests.
- **Conformance honesty:** if W3C DID/VC conformance is claimed anywhere in marketing or metadata, a published statement of which parts of which specification are implemented — currently none are.

---

## 9. What this audit did and did not establish

Established by direct inspection and execution: build, lint, typecheck and 97 passing tests; the two high-severity defects H-1 and H-2 (H-2 additionally reproduced); the absence of any deployment artifact; the absence of SDK usage in the frontend and of contract calls in the KYC service; the failing frontend test command; the dependency advisory inventory.

Not established, and therefore not claimed: whether the contracts behave correctly on Testnet; whether the SDK's default simulation source works; whether the bridge correctly ingests live events; anything about EVM-side behaviour; the current status of the hosted CI workflow.

**Verdict: not ready.** The code is better than its documentation's ambitions suggest, and its documentation is more honest than most prototypes — but it is a set of tested components with no running system, and two of those components have defects that only appear once they are actually wired together and deployed.

*Remediation of the confirmed issues, with regression tests and re-run results, is recorded in §10 below once complete.*

---

## 10. Second audit pass and remediation log

**Date:** 2026-11-05
**Tree audited:** `b84474b` plus the then-uncommitted fixes for H-1, H-2, M-1, M-3 and M-4 in the working tree.
**Method:** every source file re-read; all declared commands executed from a clean `npm ci` / `cargo` build; new dynamic reproductions described below.

The first pass's H-1, H-2, M-1, M-3 and M-4 fixes were present but **uncommitted** at the start of this pass. They were verified by the test suites below and are now covered by regression tests.

### 10.1 New findings from this pass

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| N-1 | **High** | The EVM relayer rejected **every** attestation. `StellarListener._parseEvent` validates `subject` against `/^[GC][A-Z2-7]{55}$/` (a Stellar strkey), while `EVMRelayer.relay` required `ethers.isAddress(subject)`. No Stellar address is a valid EVM address, so the only production path through the bridge always threw `attestation.subject must be a valid EVM address`. The receiver ABI also declared `address subject`, which cannot represent the source identifier. | Reproduction: parse a well-formed event, then call `relay` with a stubbed receiver and provider → error raised before signing. Fixed and covered by `relays an event produced by the listener (Stellar subject regression)`. |
| N-2 | **Medium** | The listener persisted `event.id` as the `getEvents` cursor. The RPC/SDK contract is that `cursor` is a **paging token** (`Api.EventResponse.pagingToken`); `id` is a separate field. Pagination could stall or skip when the two differ. | SDK `lib/rpc/server.d.ts` documents "use the `pagingToken` field ... to set the `cursor` parameter". Fixed and covered by `advances the cursor by paging token`. |
| N-3 | **Medium** | Events from reverted contract calls were accepted. Soroban RPC marks them `inSuccessfulContractCall: false`; they are not ledger state, so relaying one asserts compliance from a failed transaction. | `_parseEvent` did not read the field. Fixed and covered by `drops events from a reverted contract call`. |
| N-4 | **High (build)** | The uncommitted TTL regression test broke the required checks: `cargo fmt --all -- --check` exited 1 and `cargo clippy --all-targets -- -D warnings` exited 101 (`assertions_on_constants`). | Both commands reproduced at the start of this pass. Replaced with behavioural TTL tests. |
| N-5 | **Medium** | `compliance_engine` still used 4,096/17,280-ledger TTLs (~24 h) while DID and credential storage had moved to 30 days. An archived policy makes `is_compliant` return `false` for configuration that still exists. | Constants at `contracts/compliance_engine/src/lib.rs`; now 129,600/518,400 with a TTL test. |
| N-6 | **Medium** | No `LICENSE` file and no `license` field in any manifest, despite the README's MIT claim. Downstream consumers had no grant of rights. | `git ls-files LICENSE` was empty. Fixed. |

### 10.2 Changes made

| Area | Change | Regression evidence |
|---|---|---|
| `contracts/vc_verifier` | Replaced the tautological constant assertions with `test_issue_credential_extends_storage_ttl`, which reads the real persistent entry TTL via `env.as_contract(...)` and asserts it exceeds the old 24 h window. | `cargo test` 25/25 |
| `contracts/did_registry` | Added `test_register_extends_storage_ttl` with the same behavioural check. | 11/11 |
| `contracts/compliance_engine` | TTL raised to 129,600/518,400 (30 days); added `test_set_policy_extends_storage_ttl`. `try_invoke_contract` fail-closed behaviour retained. | 13/13 |
| `services/cross-chain-bridge/src/lib/stellarListener.js` | Cursor is now `pagingToken`; `inSuccessfulContractCall: false` events are dropped; parsed events carry `pagingToken`. | 20/20 bridge tests |
| `services/cross-chain-bridge/src/lib/evmRelayer.js` | Subject validated as a Stellar strkey and carried as `string`; receiver ABI changed to `receiveAttestation(string subject, ...)`; digest encoding changed from `address` to `string` for the subject. | `relays an event produced by the listener`, `rejects malformed attestations` |
| Docs | README step 3 now states the KYC service does not submit on-chain; architecture documents the string subject, paging-token cursor, failed-call filtering, and the new TTL values; placeholder pages no longer describe a non-existent issuer-list endpoint or BLS-key registration. | — |
| Licensing | Added `LICENSE` (MIT), `"license": "MIT"` in all four `package.json` files, `license = "MIT"` in all three crate manifests. | `git ls-files LICENSE` |
| Dependencies | Removed the unused direct `@stellar/stellar-sdk` from `services/kyc-issuer` and `frontend` (neither imports it); applied the in-range `qs`/`express` updates to kyc-issuer (`express` 4.22.3, `qs` 6.16.2). The frontend still installs the Stellar SDK transitively through the `file:../sdk` link, and `npm audit` does not traverse that link — its reported 0 high understates the tree. | kyc: **0 vulnerabilities** (`--omit=dev`), 31/31 tests; frontend reports 0 high but inherits the SDK's advisory transitively |
| CI | Pinned `dtolnay/rust-toolchain` to commit `360a4e93673de6630fac2478bc9e35244b01a759` (the 1.88.0 branch head) instead of `@master`. | static |
| Security process | Added `SECURITY.md` with a private-advisory disclosure route. | — |

### 10.3 Commands executed after remediation

| Command | Exit | Result |
|---|---|---|
| `cargo fmt --all -- --check` | **0** | clean |
| `cargo clippy --all-targets --locked -- -D warnings` | **0** | clean |
| `cargo test --locked` | **0** | **49 passed** (13 compliance, 11 did, 25 vc) |
| `cargo build --target wasm32-unknown-unknown --release --locked` | **0** | 3 `.wasm` artifacts |
| `npm ci && npm test` (kyc-issuer) | **0** | 31/31 |
| `npm ci && npm test` (bridge) | **0** | 20/20 |
| `npm ci && npm run build && npm test && npm run lint` (sdk) | **0** | 13/13, lint clean |
| `npm ci && npm run typecheck && npm run build` (frontend) | **0** | 167.55 kB bundle |
| `npm test` (frontend) | **1** | `No test files found` (unchanged, see below) |
| `npm audit --omit=dev` | — | kyc **0**; frontend reports 2 moderate/0 high (but see 10.4: the SDK's advisory is present transitively); sdk 2 high; bridge 2 high |

### 10.4 Dependency exception — `toml` via `@stellar/stellar-sdk`

`@stellar/stellar-sdk` 12.3.0 pins a vulnerable `toml` (five advisories, highest
severity *high*). It is a direct dependency of the SDK and the bridge, and is
still installed in the frontend through the `file:../sdk` link (npm audit does not
traverse that link, so the frontend's reported count is incomplete). The only
patched path is a breaking major upgrade to 17.4.0.
That upgrade was attempted: it removes the `SorobanRpc` namespace and pulls an
ESM-only transitive dependency (`uint8array-extras`) that Jest 29 cannot load
without an ESM transform, so the bridge and SDK suites fail to run. Shipping a
broken suite to remove an advisory that this code cannot reach was rejected.

- **Reachability:** no file calls `StellarToml` or `toml.parse()`; all SDK usage is
  `Contract`, `TransactionBuilder`, `scValToNative`, `nativeToScVal` and RPC.
- **Exception owner:** repository maintainers. **Review by:** 2026-12-05.
- **Exit:** upgrade to `@stellar/stellar-sdk` ≥ 17.4.0 together with an ESM-capable
  test runner (or a Jest ESM transform config); `npm audit --omit=dev` must then
  report 0 high.

### 10.5 Still open after this pass

These are not fixed here because they are missing components or require a
deployment, not because they were overlooked:

1. EVM deployment — `AttestationReceiver.sol` now exists and is tested locally,
   but no RPC or funded key was configured, so it has never been deployed and the
   bridge has never relayed to it.
2. Frontend — still placeholder pages; no SDK import and no API call. `npm test`
   exits 1 because no test files exist.
3. Ring signatures / privacy — verification is disabled and fails closed; no
   anonymity, selective disclosure, or unlinkability is provided.
4. SEP-10 / SEP-12 / SEP-45 — unimplemented, documented as such.
5. Testnet evidence — no contract id, deployment transaction, or credential
   issuance transaction is committed. Every end-to-end step remains **NOT
   TESTED**, not passed.
6. `initialize` is not atomic with deployment (front-running risk); the pinned
   SDK predates `__constructor`.
7. KYC storage remains plaintext in process memory with no retention job or
   retrieval-token expiry; the rate limiter has no `trust proxy` configuration.
8. `export_attestation` is unauthenticated, so anyone can generate attestation
   events for any subject/policy (spam, not forgery).

## 11. Subsequent remediation (5 November 2026)

### 11.1 Delivered after section 10

| Change | Files | Verification |
|---|---|---|
| EVM destination contract: relayer allowlist, per-subject nonce replay protection, chain-id binding, EIP-191 recovery, stale-ledger guard | `contracts/evm/contracts/AttestationReceiver.sol`, `contracts/evm/hardhat.config.js`, `contracts/evm/package.json` | 25 contract tests + 2 cross-language tests using the real `evmRelayer.js`; 27/27 pass |
| Bridge aligned with the receiver: string subject, `uint256 ledger`, receiver address and chain id in the signed digest, non-packed `abi.encode` | `services/cross-chain-bridge/src/lib/evmRelayer.js`, `__tests__/bridge.test.js` | 23/23 pass |
| KYC approval submits `VCVerifier.issue_credential` per attribute and records the transaction hashes; `503` when unconfigured, `502` on chain failure | `services/kyc-issuer/src/lib/chain.js`, `routes/issuer.js`, `lib/validate.js`, `lib/credential.js`, `.env.example` | 35/35 pass with a mocked SDK |
| KYC requests require a valid Stellar `subject` | `routes/kyc.js`, `lib/validate.js` | covered by the 35 tests |
| Deployable WASM target corrected to `wasm32v1-none` | `contracts/rust-toolchain.toml`, `.github/workflows/ci.yml`, `README.md` | see 11.2 |
| Hardhat build output ignored | `.gitignore` | `git status` shows no artifacts |

### 11.2 Testnet attempt — BLOCKED, no evidence committed

A genuine Testnet attempt was made against
`https://soroban-testnet.stellar.org`. It did **not** produce evidence that can be
cited, so none is recorded as a pass:

- `wasm32-unknown-unknown` artifacts built by the pinned Rust 1.88 are rejected by
  the Soroban VM with `Error(WasmVm, InvalidAction)` /
  `reference-types not enabled: zero byte expected`. The flag
  `-C target-feature=-reference-types` and `target-cpu=mvp` did not change the
  encoding; `wasm32v1-none` builds cleanly (23,471 bytes for `vc_verifier`).
- The upload flow reached the RPC, but the SDK 12 client could not parse the
  protocol's v4 transaction meta (`Bad union switch: 4`) before a transaction
  hash could be captured, so the contract id and subsequent
  `initialize`/`add_issuer` calls were not reached.
- No contract id, deployment transaction, or credential-issuance transaction is
  committed. No secret key was written to the repository.

Remaining work for evidence: poll with a client that understands meta v4 (SDK 17
or direct RPC JSON), derive the contract id from the explicit salt, then run the
KYC route end to end and record only public identifiers and transaction hashes.
