# Technical Audit — Stellar DID & Cross-Chain Compliance

**Audit date:** 2026-11-04
**Checkout:** `88686d1` (branch `main`, 4 commits)
**Scope:** every file in the repository — 3 Soroban contracts, 2 Node services, TypeScript SDK, React frontend, CI workflow, docs.
**Method:** full source read, dependency install from lockfiles, execution of all available build/test/lint commands with exit-status verification, static security review, and end-to-end path tracing.

> No files were modified during this audit phase. Findings below are based on executed commands and inspected source only. No live network calls to Stellar Testnet or any EVM network were performed; no credentials, funded accounts, RPC endpoints, or deployed contracts were provided. Nothing in this report claims cryptographic security, standards conformance, or deployment success.

---

## 1. Executive verdict

**Readiness: NOT READY — pre-alpha scaffold. Do not deploy, and do not present as a working system.**

The repository is a well-organized skeleton: the contract APIs, service routes, SDK surface, and documentation all exist and are internally consistent in *shape*. But the functioning core is absent or deliberately stubbed, and several paths are actively unsafe if exposed:

- **The contracts do not compile to deployable WASM.** `cargo build --target wasm32-unknown-unknown --release` fails with **159 compile errors** (`exit 101`). Nothing can be deployed to Testnet at all. The cause is a single workspace misconfiguration.
- **The ring-signature verifier accepts any syntactically-shaped signature.** `verify_ring_stub` returns `true` whenever the ring is non-empty and the response count matches. This is not a partial implementation; it is an accept-all.
- **Two authorization checks are documented as TODO and are the only thing standing between the system and forgery:** any address can replace any attribute ring, and any address can mark any subject compliant under any policy.
- **The KYC issuer service has no authentication on any route.** It accepts the issuer's private key in a request body, lets any caller act as any issuer, exposes full KYC PII (including document photos) to unauthenticated callers, and allows one-time credential retrieval keyed on a client-chosen `userId`.
- **The cross-chain bridge fabricates attestations.** It emits `compliant: true` for every `contract_credited` Horizon effect it happens to see, with `policy: "unknown"`, and relays a literal `"stub-signature"`. No EVM receiver contract exists in the repository.
- **The frontend cannot be installed or built.** It depends on an unpublished package (`@stellar-did/sdk@*` → `E404`) and is missing `index.html`, `vite.config.*`, `tsconfig.json`, `src/main.tsx`, and a lockfile. All five pages are placeholders that set "Not yet implemented".
- **The SDK's six methods all `throw new Error("Not implemented")`.** `npm test` fails because no tests exist.
- **The claimed cryptographic foundation is unavailable in the pinned toolchain.** `soroban-sdk 21.7.7` exposes only `sha256`, `keccak256`, `ed25519_verify`, `secp256k1_recover`, `secp256r1_verify`. There are **zero** `bls12_381` host functions. BLS12-381 host functions shipped in **Protocol 22 / CAP-0059**; the project pins Protocol-21-era SDK.

Only two things genuinely pass: the KYC service's 7 route tests, and the 4 contract unit tests — and one of those contract tests asserts that the insecure stub returns `true`, i.e. it is a regression test *for the vulnerability*.

**Recommended posture:** treat as an unmerged prototype. Fix the build, remove or fail-close every accept-all path, and stop advertising BLS ring signatures / cross-chain compliance until there is an audited implementation.

---

## 2. Feature status

Statuses: **PASS** = executed, exit 0, behavior verified · **FAIL** = executed, non-zero or wrong result · **BLOCKED** = cannot execute (missing credentials/network/deployment/external artifact) · **NOT TESTED** = no executable check exists in the repo.

| # | Feature | Status | Basis |
|---|---|---|---|
| 1 | Contracts compile for deployment (WASM) | **FAIL** | `exit 101`, 159 errors |
| 2 | Contract unit tests | **PASS** | `cargo test --locked`, 4/4 pass |
| 3 | Rust formatting | **FAIL** | `cargo fmt --check` exit 1, 103 diff lines |
| 4 | Rust lint (Clippy) | **PASS** | `-D warnings`, exit 0 |
| 5 | DID register/resolve (unit) | **PASS** | local test asserts hash + `active` |
| 6 | DID identifier correctness | **FAIL** | hardcoded `did:stellar:placeholder` |
| 7 | DID update/deactivate | **FAIL** | no tests; no events; irreversible; untested paths |
| 8 | DID key rotation / recovery | **FAIL** | not implemented (doc TODO) |
| 9 | Issuer authorization on ring creation | **FAIL** | `TODO`, no check |
| 10 | Ring-signature verification | **FAIL** | accept-all stub |
| 11 | Credential expiry | **FAIL** | not implemented |
| 12 | Credential revocation | **FAIL** | not implemented |
| 13 | Proof replay protection | **FAIL** | no nonce/nullifier/challenge registry |
| 14 | Compliance policy enforcement | **FAIL** | `required_attributes` never read |
| 15 | Compliance authorization | **FAIL** | any address can self-certify |
| 16 | Cross-chain attestation export | **FAIL** | returns unsigned map; no event |
| 17 | Stellar→EVM relay | **FAIL** | fabricated payload; no verification |
| 18 | EVM destination contract | **FAIL** | absent from repo |
| 19 | KYC request submission | **PASS** | 7/7 service tests pass |
| 20 | KYC issuer auth (any route) | **FAIL** | none exists |
| 21 | Credential retrieval auth | **FAIL** | IDOR, client-chosen key |
| 22 | PII minimization | **FAIL** | full PII returned unauthenticated |
| 23 | SDK usability | **FAIL** | all methods throw |
| 24 | SDK tests | **FAIL** | `npm test` exit 1, no tests |
| 25 | SDK lint | **FAIL** | `exit 127`, eslint not installed |
| 26 | Frontend install | **FAIL** | `E404` unpublished dependency |
| 27 | Frontend build | **FAIL** | missing `index.html` entry |
| 28 | Frontend lint | **NOT TESTED** | no `lint` script, no ESLint config |
| 29 | Frontend functionality | **FAIL** | 25 TODO/"not implemented" markers |
| 30 | Bridge service tests | **FAIL** | `npm test` exit 1, no tests |
| 31 | Dependency hygiene | **FAIL** | 1 critical + 6 high advisories |
| 32 | CI pipeline correctness | **FAIL** | see §7 |

### End-to-end integration (required flow)

Every item below requires live Stellar Testnet and/or EVM access, deployed contracts, and funded keys. None were available; per instruction these are **BLOCKED**, and I have not substituted mocks for live verification.

| Step | Status | Blocking reason |
|---|---|---|
| 1. Register & resolve a DID on Testnet | **BLOCKED** | No deployable WASM (build fails); no funded account; no RPC creds. Local unit test only. |
| 2. Issue credential via authorized issuer | **BLOCKED** | No deployed contract; issuer route unauthenticated; credential builder is a stub. |
| 3. Generate & verify valid attribute proof | **BLOCKED** | No BLS host functions in SDK 21; verifier is accept-all; SDK generator unimplemented. |
| 4. Reject invalid/forged/expired/replayed proofs | **BLOCKED** | Cannot reject: verifier accepts anything; no expiry or replay model exists to reject. |
| 5. Evaluate compliance policy correctly | **BLOCKED** | Policy attributes are never evaluated by any code path. |
| 6. Relay genuine attestation to EVM testnet | **BLOCKED** | No EVM receiver contract; no signature scheme; no RPC. |
| 7. Verify destination result; reject unauthorized/repeat | **BLOCKED** | Destination contract does not exist. |
| 8. Revoke credential / update policy and observe effect | **BLOCKED** | No revocation function; policy updates have no effect by design. |

---

## 3. Executed commands and actual results

All runs on Linux, Node `v24.22.2`, npm `11.19.1`, Rust `1.88.0` (`rust-toolchain.toml`), `soroban-sdk 21.7.7`.

| Command | Exit | Result |
|---|---|---|
| `cargo fmt --all -- --check` | **1** | 103 lines of diffs across all three contracts |
| `cargo clippy --all-targets --locked -- -D warnings` | **0** | Clean |
| `cargo test --locked` | **0** | 4 tests pass (did 2, vc 1, compliance 1) |
| `cargo build --target wasm32-unknown-unknown --release --locked` | **101** | 159 errors; **no `.wasm` artifacts produced** |
| `npm ci` (services/kyc-issuer) | **0** | 439 packages |
| `npm test` (services/kyc-issuer) | **0** | 7/7 pass |
| `npm ci` (sdk) | **0** | 335 packages |
| `npm run build` (sdk) | **0** | `tsc` emits `dist/` |
| `npm test` (sdk) | **1** | `No tests found, exiting with code 1` |
| `npm run lint` (sdk) | **127** | `sh: 1: eslint: not found` |
| `npm install` (services/cross-chain-bridge) | **0** | 412 packages (no lockfile in repo) |
| `npm test` (services/cross-chain-bridge) | **1** | `No tests found` |
| `npm install` (frontend) | **1** | `E404` — `@stellar-did/sdk@*` not published |
| `npx vite@5 build` (frontend) | **1** | `Could not resolve entry module "index.html"` |
| `npm audit --omit=dev` (kyc-issuer) | — | 9 vulns: **1 critical, 6 high**, 2 moderate |
| `npm audit --omit=dev` (bridge) | — | 2 high |
| `npm audit --omit=dev` (sdk) | — | 5 high |

**CI pass/fail:** not verifiable from this checkout — no Actions run history is available and repository visibility is unconfirmed. §7 contains static defects that make the green/red status untrustworthy regardless.

---

## 4. Findings

### CRITICAL

#### C-1 — Contracts cannot be built for deployment (`testutils` enabled in the workspace dependency)
**Where:** `contracts/Cargo.toml:10`
```toml
[workspace.dependencies]
soroban-sdk = { version = "21.0.0", features = ["testutils"] }
```
**Evidence:** `cargo build --target wasm32-unknown-unknown --release --locked` → `exit 101`, 159 errors, dominated by `E0433: failed to resolve: use of unresolved module or unlinked crate 'std'` (76×), `soroban_env_host` (9×), `serde`/`serde_json` (18×). No `.wasm` files are produced.
**Impact:** The `testutils` feature pulls a std/host-side test harness into the guest build. Every contract in the workspace is undeployable. `cargo test` passes because it builds for the host, masking the failure.
**Remediation:** Remove `features = ["testutils"]` from `[workspace.dependencies]`; enable it only in each crate's `[dev-dependencies]` (already present).
**Acceptance:** `cargo build --target wasm32-unknown-unknown --release --locked` exits 0 and emits three `.wasm` artifacts.

#### C-2 — Ring-signature verification accepts arbitrary signatures
**Where:** `contracts/vc_verifier/src/lib.rs:110-136` (`verify_credential`), `:171-173` (`verify_ring_stub`)
```rust
fn verify_ring_stub(_env: &Env, ring: &AttributeRing, _msg: &Bytes, sig: &RingSignature) -> bool {
    !ring.public_keys.is_empty() && sig.responses.len() == ring.public_keys.len()
}
```
**Impact:** Any caller supplying a ring-length-matching vector of arbitrary bytes is "verified". The `challenge` field is never read; `message` is never bound. Proof of concept: the committed test `test_verify_credential_stub` (`:196-213`) constructs `[2u8;32]` responses and a `[1u8;32]` challenge and asserts `true`.
**Root blocker:** no BLS12-381 host functions exist in the pinned SDK (see C-3).
**Remediation:** Remove the accept-all path. Fail closed (return `false` and emit a distinct `VerificationUnavailable` event) until a specified, audited scheme is implemented. Do not increment counters on a stub.
**Acceptance:** a test asserting arbitrary bytes are rejected returns `false` and does not mutate state.

#### C-3 — Claimed BLS12-381 support does not exist in the pinned toolchain
**Where:** `contracts/Cargo.toml:10` (`soroban-sdk 21`), `README.md:9,51`, `docs/architecture.md:16,76,111`, `docs/sep-references.md` (BLS code block)
**Evidence:** `soroban-sdk-21.7.7/src/crypto.rs` exposes only `sha256`, `keccak256`, `ed25519_verify`, `secp256k1_recover`, `secp256r1_verify`. `grep -ri bls` over the crate's `src/` returns **0 matches**. BLS12-381 host functions (CAP-0059) require Protocol 22+.
**Impact:** The documented implementation path (`env.crypto().bls12_381_g1_add(...)`) does not compile. README's "BLS12-381 ring signatures (native Soroban support)" is false for this dependency set. There is also no ring-signature scheme specified anywhere (no paper, no domain separation, no rogue-key handling), so even a version bump would not yield a secure design.
**Remediation:** Either (a) upgrade to `soroban-sdk >= 22` and adopt a named, audited ring-signature construction, or (b) re-scope to issuer-signed credentials without a ring. Correct the docs in either case.
**Acceptance:** docs match the toolchain; a stated scheme with test vectors exists; external review before any claim of anonymity.

#### C-4 — Any address can replace any attribute ring (issuer authorization missing)
**Where:** `contracts/vc_verifier/src/lib.rs:91-95`
```rust
pub fn set_attribute_ring(env: Env, issuer: Address, attribute: Symbol, ring: Vec<BytesN<96>>) {
    issuer.require_auth();
    // TODO: verify `issuer` is in the registered issuers list
```
**Impact:** `require_auth` only proves the caller controls *their own* address. An attacker authorizes themselves, then overwrites `RING("kyc_passed")` with a ring of their own keys. They can then produce a signature their own verifier accepts (trivially, given C-2) and satisfy any downstream compliance check. `add_issuer` registration (`:79`) is therefore decorative for rings.
**Remediation:** Store issuers as `Address` (not only BLS pubkeys), require the caller to be in that set, and reject unauthorized calls with a typed error.
**Acceptance:** test: unregistered issuer cannot set a ring; registered issuer can.

#### C-5 — Any address can mark any subject compliant under any policy
**Where:** `contracts/compliance_engine/src/lib.rs:96-121`
```rust
pub fn set_compliance_status(env: Env, caller: Address, subject: Address, policy: Symbol, compliant: bool) {
    caller.require_auth();
    // TODO: verify caller is the VCVerifier contract address
```
**Impact:** Complete compliance bypass. `set_compliance_status(me, me, "defi_pool", true)` succeeds for any caller, and `export_attestation` (`:153`) then reports `true`, which the bridge relays. This is the most directly exploitable economic vulnerability in the repository.
**Remediation:** Remove the unauthenticated setter. Derive compliance from attested credentials (C-6) via cross-contract query; if a stored override must exist, restrict it to an admin/verifier allowlist.
**Acceptance:** test: non-authorized caller reverts; compliance cannot be set without a valid credential.

#### C-6 — Compliance policies are never evaluated
**Where:** `contracts/compliance_engine/src/lib.rs:124-131`
```rust
pub fn is_compliant(env: Env, subject: Address, policy: Symbol) -> bool {
    ...
    .get::<_, ComplianceStatus>(&key).map(|s| s.compliant).unwrap_or(false)
```
**Impact:** `Policy.required_attributes` (`:38-39`) is written by `set_policy` (`:76`) and **never read anywhere**. `is_compliant` looks up a boolean someone else stored. Updating a policy cannot change any outcome — the audit's required behaviour #5 and #8 are structurally impossible. `get_policy` will panic for an unknown policy while `is_compliant` silently returns a stored value for a non-existent policy.
**Remediation:** Implement live evaluation: load the policy, resolve each required attribute to credential validity, `AND` the results, return `false` for unknown policies. Add policy versioning/`evaluated_at` so stale results are detectable.
**Acceptance:** tests where a subject satisfies 0/1/all required attributes yield `false`/`false`/`true`, and a policy edit immediately changes the result.

#### C-7 — KYC issuer routes are unauthenticated; approval trusts client-supplied identity
**Where:** `services/kyc-issuer/src/routes/issuer.js:46-58`
```js
const { requestId, issuerPubkey, issuerPrivkey } = req.body;
...
if (kycReq.issuerPubkey !== issuerPubkey) return res.status(403).json({ error: "Forbidden" });
const credential = await buildCredential(kycReq, issuerPrivkey);
```
**Impact:** The only "authorization" is that the caller knows a *public* key, which is public by definition. Anyone can approve any request and receive a credential for it. `isseurPrivkey` is transmitted in a JSON body — exposed to logs, proxies, and browser history — and is then **ignored**: `buildCredential` (`src/lib/credential.js:24`) never reads it, so no approval is ever signed by anything.
**Remediation:** Authenticate issuers server-side (API key or SEP-10 JWT), derive issuer identity from the credential, never accept private keys over HTTP, and sign/hash the credential envelope with a server-held key.
**Acceptance:** unauthenticated approve → 401; wrong-issuer approve → 403; no secret material accepted in any body.

#### C-8 — Credential retrieval is an unauthenticated IDOR keyed on a client-chosen ID
**Where:** `services/kyc-issuer/src/routes/kyc.js:26-45` (client supplies `userId`), `:60-66`
```js
const cred = store.issuedCredentials.get(req.params.userId);
store.issuedCredentials.delete(req.params.userId); // one-time retrieval
```
**Impact:** (a) **Theft:** anyone who knows/guesses a `userId` retrieves another person's credential, including private key material. (b) **Griefing/DoS:** the read deletes the credential, so an attacker permanently destroys a victim's credential. (c) **Hijack:** because `userId` is client-chosen at request time, an attacker can file a request using a victim's `userId` and later claim the resulting credential.
**Remediation:** Issue a high-entropy one-time retrieval token bound to the request, return it only to the authenticated requester, and look up by token — never by a user-supplied identifier. Do not delete on an unauthenticated read.
**Acceptance:** retrieval with a wrong/absent token → 404/401; token is single-use; victim's credential cannot be fetched or destroyed by a third party.

#### C-9 — Full KYC PII, including document photos, is exposed unauthenticated
**Where:** `services/kyc-issuer/src/routes/issuer.js:26-35`
```js
const pending = [...store.kycRequests.values()].filter(
  (r) => r.issuerPubkey === issuerPubkey && r.status === "pending"
);
return res.json(pending);   // full records incl. personalInfo + documentPhoto
```
Combined with `kyc.js:33-41`, records store `personalInfo` and base64 `documentPhoto` verbatim.
**Impact:** Anyone who supplies any `issuerPubkey` query value can enumerate pending applications and receive identity documents. This is a reportable personal-data breach if deployed.
**Remediation:** Require issuer auth; return a redacted projection (requestId, attributes, submitted-at, status); serve documents only through an authenticated, audited, short-lived endpoint.
**Acceptance:** list endpoint contains no `personalInfo`/`documentPhoto` fields under any circumstances.

#### C-10 — Cross-chain bridge fabricates compliance attestations
**Where:** `services/cross-chain-bridge/src/lib/stellarListener.js:56-62`, `src/lib/evmRelayer.js:51`
```js
_parseAttestation(effect) {
  return { subject: effect.account, policy: "unknown", compliant: true, ledger: effect.created_at };
}
...
const signature = ethers.toUtf8Bytes("stub-signature");
```
**Impact:** The bridge asserts `compliant: true` for *any* `contract_credited` effect, and relays it with a constant placeholder signature. Combined with C-5 this manufactures cross-chain compliance assertions out of nothing. The listener also polls Horizon `/effects`, which cannot observe Soroban contract events, so it is not even reading the intended source.
**Remediation:** Remove the fabricated parser. Consume Soroban events via RPC `getEvents` with contract/topic filters, decode XDR, validate every field, and require a signature verifiable by the destination contract before relaying. Fail closed when no verifier is configured.
**Acceptance:** no attestation is emitted without a decoded, verified source event; a test asserts malformed events are dropped.

### HIGH

#### H-1 — DID identifiers are a hardcoded placeholder
**Where:** `contracts/did_registry/src/lib.rs:67-68`
```rust
// TODO: derive did:stellar:<network>:<address> properly
let did_id = String::from_str(&env, "did:stellar:placeholder");
```
**Impact:** Every DID in the system resolves to the same identifier. The documented contract (`docs/architecture.md:63-64`) promises `did:stellar:<address>`. Any off-chain resolution or credential subject binding is therefore wrong or ambiguous.
**Remediation:** Build `did:stellar:` + the controller's strkey (`Address::to_string`), optionally with the network id for the network-specific method.
**Acceptance:** two distinct controllers resolve to distinct, correctly formatted identifiers.

#### H-2 — No contract emits any event
**Where:** all three `contracts/*/src/lib.rs`; TODOs at `did_registry:79,101,119`, `vc_verifier:135`; `compliance_engine` doc `:17`
**Evidence:** `grep -rn "events()" contracts/*/src` → no matches.
**Impact:** The entire cross-chain design (`docs/architecture.md:88-93`: "ComplianceEngine emits attestation event → Bridge detects event") has no source. The bridge cannot work as documented even with a correct listener.
**Remediation:** Publish typed events for DID register/update/deactivate, credential issue/revoke, proof verified/rejected, and attestation export.
**Acceptance:** tests assert the expected topics/data are emitted.

#### H-3 — `verify_credential` panics instead of returning `false`
**Where:** `contracts/vc_verifier/src/lib.rs:117-121`
**Impact:** Contradicts its own doc comment ("Return false (not panic) on invalid signatures"). A caller cannot distinguish "ring missing" from "invalid proof"; integrators that treat a panic as fatal will brick their flow, and the panic path is itself a cheap griefing surface.
**Remediation:** Return `false` (or a typed `Result`) for unknown rings.
**Acceptance:** test invoking with an unknown attribute returns `false`.

#### H-4 — No replay protection, no prover binding, no domain separation
**Where:** `contracts/vc_verifier/src/lib.rs:110-136`
**Impact:** `message` is arbitrary caller-supplied bytes accepted without any nonce, ledger bound, contract-id binding, subject binding, or `require_auth`. Any valid proof can be replayed indefinitely; any party can submit someone else's proof; and because the attribute is a parameter rather than part of a signed domain, a proof can be relabeled across attributes whose rings overlap. `proof_count` (`:132-134`) increments on every replay, so the published metric is inflatable.
**Remediation:** Bind the signed message to a domain (`contract_id || network || attribute || subject || nonce || ledger`) and maintain a consumed-nonce/nullifier registry. Require the prover's authorization where the design permits it.
**Acceptance:** identical proof submitted twice → second rejected; proof for attribute A rejected when presented as B.

#### H-5 — No credential expiry or revocation exists
**Where:** `contracts/vc_verifier/src/lib.rs:13-18` (TODOs); no expiry field in `AttributeRing`/`RingSignature`.
**Impact:** Audit requirements for expiry, revocation, and key rotation have no implementation. `DIDRegistry.deactivate` (`:105`) does not invalidate credentials; a deactivated or compromised identity remains provable forever.
**Remediation:** Add credential records with `expires_at` and `revoked`, an issuer/admin revocation path, and validity checks that compose into compliance evaluation.
**Acceptance:** expired and revoked credentials yield "not compliant"; deactivation invalidates credentials.

#### H-6 — Persistent storage TTL is never extended
**Where:** `did_registry:73,97,116`; `vc_verifier:97`; `compliance_engine:80,110` — all `persistent().set(...)` with no `extend_ttl`.
**Impact:** Soroban persistent entries expire and are archived. Unbumped DID documents, rings, and statuses will silently disappear after the TTL window; `resolve`/`get_ring` then panic ("not found"). For a long-lived identity registry this is a data-loss bug.
**Remediation:** Extend TTL on write and on read of long-lived entries (with explicit constants).
**Acceptance:** a test asserting a bump on write; documented retention policy.

#### H-7 — Contract initialization is front-runnable
**Where:** `vc_verifier:64-76`, `compliance_engine:70-75`
**Impact:** `initialize` accepts any caller as admin and only guards re-initialization. If deployment and initialization are not atomic, an attacker initializes first and becomes admin — able to register issuers (C-4) or set policies (C-5).
**Remediation:** Use an atomic constructor (Protocol 22 `__constructor`) or a deployer-gated initializer; document the deploy sequence.
**Acceptance:** a second/unauthorized initialization reverts; deployment instructions include atomic init.

#### H-8 — EVM relay reports reverted transactions as successes
**Where:** `services/cross-chain-bridge/src/lib/evmRelayer.js:53-55`
```js
const tx = await this.receiver.receiveAttestation(subject, policy, compliant, signature);
await tx.wait();
return tx.hash;
```
**Impact:** `tx.wait()` resolves for reverted transactions (status 0) on ethers v6; the hash is returned and `index.js:46` logs "Relayed to EVM". Failures are silently reported as success, so no retry occurs and the operator believes compliance propagated.
**Remediation:** Inspect `receipt.status` and throw on non-1; surface failures to the retry path.
**Acceptance:** unit test with a mocked receipt `{status: 0}` rejects.

#### H-9 — No EVM destination contract exists
**Where:** `contracts/` contains only three Rust crates; `evmRelayer.js:20` ABI references `receiveAttestation` on a contract that is not in the repo (`contracts/evm/` referenced in comments but absent).
**Impact:** Destination-side access control, finality handling, duplicate suppression, and replay protection — all explicitly in the audit scope — **cannot exist**. The relayer targets an unknown, unaudited ABI.
**Remediation:** Implement and publish `AttestationReceiver.sol` with relayer allowlisting, per-(subject,policy) nonce/epoch replay protection, Stellar-signed payload verification, and finality policy; or remove the bridge from the release scope.
**Acceptance:** contract source + tests + deployment procedure in-repo.

#### H-10 — Stellar listener cannot observe the events it claims to consume
**Where:** `services/cross-chain-bridge/src/lib/stellarListener.js:34-45` (Horizon `effects()`), `:9` (cursor persistence TODO)
**Impact:** Soroban contract events are not Horizon effects; filtering on `contract_credited` yields unrelated account/base-asset effects. `contractId` is stored but never used. The cursor is not persisted, so a restart re-processes or skips windows, and there is no duplicate suppression → repeated relays (compounding H-9).
**Remediation:** Use Soroban RPC `getEvents` with `contractIds` + topic filters, persist the paging cursor, and deduplicate by event id.
**Acceptance:** duplicate event ids are relayed once; restart resumes from the stored cursor.

#### H-11 — Frontend cannot be installed or built
**Where:** `frontend/package.json` (`"@stellar-did/sdk": "*"`); missing `index.html`, `vite.config.*`, `tsconfig.json`, `src/main.tsx`, `package-lock.json`.
**Evidence:** `npm install` → `E404`; `npx vite@5 build` → `Could not resolve entry module "index.html"`.
**Impact:** The only user-facing layer is non-functional. No UI→contract path exists to trace, so every E2E step is unreachable from the product surface.
**Remediation:** Publish or link the SDK (`file:../sdk`), add Vite entry/config/tsconfig, commit a lockfile.
**Acceptance:** `npm ci && npm run build` exits 0.

#### H-12 — SDK is entirely unimplemented
**Where:** `sdk/src/clients/DIDClient.ts:38,46`; `VCClient.ts:37,57,73`; `ComplianceClient.ts:30,39` — seven `throw new Error("Not implemented")`.
**Impact:** No programmatic access to any contract. Both `npm test` (no tests) and `npm run lint` (eslint absent) fail, and `@stellar/stellar-sdk` is a declared but unused dependency.
**Remediation:** Implement read paths via `simulateTransaction` and write paths via transaction assembly + caller signing; add tests and the missing dev dependencies.
**Acceptance:** `npm test` and `npm run lint` exit 0; clients perform real simulations.

#### H-13 — Vulnerable dependencies
**Evidence:** `npm audit --omit=dev`.
- `services/kyc-issuer`: **1 critical** (`proxy-addr` — IP spoofing via IPv4-mapped IPv6, reachable through Express), **6 high** (`axios` prototype pollution ×2, `body-parser` DoS, `follow-redirects` header/credential leakage, `form-data` CRLF injection, `toml` prototype pollution + recursion), 2 moderate (`qs`, `uuid`).
- `services/cross-chain-bridge`: 2 high (`@stellar/stellar-sdk` → `toml`).
- `sdk`: 5 high (`@stellar/stellar-sdk` → `toml`, `axios`, `follow-redirects`, `form-data`).
**Impact:** The issuer service is the highest-risk surface: `proxy-addr`/`body-parser` issues undermine rate limiting and body-size enforcement; `form-data`/`follow-redirects` matter because the service handles documents and outbound calls.
**Remediation:** Upgrade `@stellar/stellar-sdk` (pulls patched transitive deps), bump `express`/`qs`/`uuid`/`toml`/`axios` chains, add `npm audit` to CI with a documented threshold.
**Acceptance:** `npm audit --omit=dev` reports 0 critical/high, or each exception is documented with rationale.

#### H-14 — Issuer private key accepted over HTTP
**Where:** `services/kyc-issuer/src/routes/issuer.js:47,55`; unused-parameter in `src/lib/credential.js:24`.
**Impact:** Secret material in request bodies is captured by access logs, proxies, error trackers, and client-side history. Worse, it is ignored, creating a false impression that approvals are cryptographically bound to the issuer.
**Remediation:** Remove from the API; hold signing keys server-side (env/KMS) and never echo them.
**Acceptance:** no request schema contains a private key; approval produces a verifiable signature.

#### H-15 — No state-transition validation on KYC requests
**Where:** `services/kyc-issuer/src/routes/issuer.js:46-79`
**Impact:** `approve` and `reject` never check `status === "pending"`, so requests can be approved repeatedly (overwriting the credential), rejected after approval, or rejected twice. `rejectionReason` is user-supplied and unbounded.
**Remediation:** Enforce `pending → approved | rejected` as the only transitions; return 409 otherwise.
**Acceptance:** tests cover double-approve, approve-after-reject, reject-after-approve.

### MEDIUM

- **M-1 — `document_hash` is unvalidated.** `did_registry:59-73` accepts empty or arbitrarily large `Bytes`. Enforce a length policy (e.g. 32-byte SHA-256 or a documented CID range).
- **M-2 — Ring size is unbounded.** `vc_verifier:91-99` accepts any-length ring; once verification iterates members, an attacker-supplied huge ring is a gas/CPU DoS. Cap it (e.g. ≤ 16) and reject duplicates (rogue-key attack surface for any future BLS scheme).
- **M-3 — `proof_count` is a spammable global mutable metric.** `vc_verifier:132-134` writes on every unauthenticated call. It is neither private (it is a public counter) nor meaningful, and enables storage/gas griefing. Remove or make it per-issuer and authenticated.
- **M-4 — Issuers can never be removed.** `vc_verifier:79-89` has `add_issuer` only. Compromise or offboarding is permanent. Add `remove_issuer` + admin rotation.
- **M-5 — No admin rotation in either contract.** A single immutable admin key is a single point of failure.
- **M-6 — Permissive CORS, no rate limiting, 5 MB JSON body.** `services/kyc-issuer/src/index.js:34-35` uses `cors()` (all origins) and `express.json({limit:"5mb"})` before any auth. Combined with base64 document upload this is a cheap memory/DoS surface, and contradicts the TODO at `index.js:26`.
- **M-7 — Error messages leak internals.** `issuer.js:60` returns `err.message` to clients.
- **M-8 — No attribute or key-format validation.** `kyc.js:28` only checks presence/array-ness; arbitrary attribute strings flow into on-chain `Symbol`s and storage keys, and `issuerPubkey` is never checked against the documented 192-hex-char format.
- **M-9 — Compliance status never goes stale.** `ComplianceStatus.evaluated_at` (`compliance_engine:45`) is written and never read; a one-time `true` persists forever.
- **M-10 — SDK test/lint scripts are broken.** `npm test` → exit 1 (no tests, no jest/ts-jest config); `npm run lint` → exit 127 (eslint is not a dependency). `ts-jest` is installed but unconfigured.
- **M-11 — CI does not verify what matters.** `.github/workflows/ci.yml`: contracts job runs only `cargo test` (no `fmt`, no `clippy`, **no WASM build** — which is why C-1 is invisible); no frontend job; no bridge job; SDK job builds but never tests; `cargo test` omits `--locked`; `dtolnay/rust-toolchain@master` is an unpinned moving ref.
- **M-12 — Frontend pages are all placeholders.** 25 TODO/"not implemented" markers across `frontend/src`; `ProvePage`/`IssuerPage` use `alert()`. No page calls the SDK or any API.
- **M-13 — PII retained unencrypted with no cleanup.** `store.js` holds `personalInfo`/`documentPhoto` in plaintext memory; the documented 24h cleanup is a TODO. Restart-loss is presented as a privacy feature but is really a data-integrity gap.
- **M-14 — Dead dependencies and unused config.** `multer` (issuer), `express` (bridge), `uuidv4` import in `index.js:28`; both `.env.example` files declare variables (`SOROBAN_RPC_URL`, `VC_VERIFIER_CONTRACT_ID`, `COMPLIANCE_ENGINE_CONTRACT_ID`, `NETWORK_PASSPHRASE`) that no code reads.
- **M-15 — SEP claims are unimplemented.** SEP-10/12/45 are listed as standards (`README.md:50`, `docs/architecture.md:108-110`); `docs/sep-references.md` marks all three as TODO and no middleware, schema, or client exists.
- **M-16 — Documented tooling does not exist.** `docs/contributing.md` states "ESLint + Prettier (configs in each package)"; there is no ESLint or Prettier config anywhere and no lint script in the frontend.
- **M-17 — Non-reproducible builds.** No lockfile for the frontend or the bridge, no `engines` field, and the bridge's `jest` has no tests.
- **M-18 — `.env.example` begins with a literal `[TEMPLATE]` line** in both services; copying it verbatim produces an invalid env file.

### LOW

- **L-1 — Formatting is not clean.** `cargo fmt --check` reports 103 diff lines (line-wrapping only) across all three contracts; CI never checks it.
- **L-2 — Documentation references storage that does not exist.** `did_registry:11` documents a `CTRL:<did>` controller key that is never written or read.
- **L-3 — `deactivate` is irreversible with no recovery path.** Documented as intentional, but there is no rotation/recovery (doc TODO at `:14-16`), so a lost key permanently burns the DID.
- **L-4 — Misleading bridge startup logs.** `evmRelayer.js:26-27` disables itself with only a warning, while `index.js:40` still logs "Bridge starting"; `relay` then returns `null` and `index.js:46` logs "Relayed to EVM: null".
- **L-5 — `should_panic` assertion is loose.** `did_registry:139` expects `"DID already registered"`; the actual message (`:64`) is `"DID already registered for this address"`. Substring matching hides message drift.
- **L-6 — No `LICENSE` file** despite the MIT claim in `README.md:59`.

---

## 5. README / documentation claims that exceed demonstrated functionality

| Claim | Location | Reality |
|---|---|---|
| "compliance status propagates to EVM chains — no re-verification needed" | `README.md:3` | No EVM contract, no verifiable payload, fabricated relay (C-10, H-9) |
| "generate a BLS ring signature client-side" | `README.md:9` | SDK throws `Not implemented`; no BLS library in any package (H-12, C-3) |
| "BLS ring signature credential verification" | `README.md:18`, `architecture.md:120` | Accept-all stub (C-2) |
| "BLS12-381 ring signatures (native Soroban support)" | `README.md:51`, `architecture.md:111` | Zero BLS host functions in SDK 21; contracts don't compile for WASM (C-1, C-3) |
| "Compliance Engine enforces policy rules on-chain" | `README.md:10` | `required_attributes` never read (C-6) |
| "compliance attestations relay to EVM chains automatically" | `README.md:11` | Polling Horizon effects; no attestations exist (H-2, H-10) |
| "anonymity set = ring size (default: 5)" | `architecture.md:102` | Decoys are `Buffer.alloc(96).fill(i)` constants; no anonymity (C-10) |
| "credentials deleted after one-time retrieval" | `architecture.md:104` | True, but unauthenticated and keyed on a client-chosen ID (C-8) |
| "W3C DID Core / VC Data Model" conformance | `README.md:49`, `architecture.md:106-107` | No DID document format, no VC envelope, DID id is `placeholder` (H-1) |
| SEP-10/12/45 support | `README.md:50` | All TODO; no implementation |
| "`soroban-cli` ≥ 21.0" + Testnet deploy instructions | `contributing.md:20,120-140` | Deploy instructions cannot succeed — WASM build fails |
| "ESLint + Prettier (configs in each package)" | `contributing.md:76` | No configs, no lint script |
| "Add a `// TODO` for every unimplemented path" | `contributing.md:79` | Followed — which is precisely why the scope was over-claimed |

---

## 6. Cross-cutting gaps

- **Privacy:** The anonymity claim rests on stub decoys, and the service that handles raw KYC documents has no auth, no retention limit, and no encryption. Ring unlinkability was never implemented, so "proofs for different attributes cannot be correlated" is unsupported.
- **Interoperability:** No DID document/VC serialization, no `did:stellar` method spec, no SEP compliance, no EVM ABI artifact, no event schema — nothing another team could integrate against.
- **Deployment:** No WASM artifacts, no deploy scripts, no network configuration consumed by code, no admin/issuer bootstrap procedure, no upgrade or TTL-retention policy, no address book. No deployment addresses or transaction hashes exist, and none are fabricated here.
- **Observability:** No events, no structured logging, no metrics; the bridge's success logs are wrong (H-8, L-4).
- **Cryptography:** No scheme is specified, so there is nothing to validate for standards conformance. Correctness claims require a named construction, test vectors, and independent review.

---

## 7. Remediation plan and acceptance criteria

Ordered by risk × deployability. Fixes 1–6 are prerequisites for *any* demonstration.

| Priority | Finding | Action | Acceptance |
|---|---|---|---|
| P0 | C-1 | Move `testutils` to dev-dependencies only | WASM release build exits 0, 3 artifacts |
| P0 | C-2 | Delete accept-all verifier; fail closed, no state mutation | forged/arbitrary signature → `false`, no counter change |
| P0 | C-4 | Register issuers as `Address`; require membership for ring writes | unregistered issuer reverts |
| P0 | C-5, C-6 | Replace free-form status writes with policy evaluation over attested credentials | unauthorized write reverts; 0/1/all attributes → `false/false/true`; policy edit changes result |
| P0 | C-7, C-8, C-9 | Issuer auth, no secrets in bodies, token-based retrieval, redacted listings | 401/403 tests; no PII in list; single-use token |
| P0 | C-10, H-8, H-10 | Remove fabricated parser; verify events; check `receipt.status`; dedupe + cursor | malformed event dropped; `status:0` rejected; duplicate relayed once |
| P1 | H-1, H-2, H-6 | Real DID id, typed events, TTL bumps | distinct ids; event assertions |
| P1 | H-3, H-4, H-5 | No-panic verification, domain binding + nonce, expiry/revocation | replay rejected; expired/revoked invalid |
| P1 | H-11 | Frontend entry/config/tsconfig/lockfile, local SDK link | `npm ci && npm run build` exit 0 |
| P1 | H-12, M-10 | Implement SDK read paths; add tests + missing dev deps | `npm test`, `npm run lint` exit 0 |
| P1 | H-13 | Dependency upgrades | audit: 0 critical/high or documented exceptions |
| P2 | H-7, M-2–M-9 | Constructor-gated init, admin/issuer rotation, ring caps, CORS allowlist, rate limit, error sanitization, staleness | targeted tests |
| P2 | M-11 | CI: fmt, clippy, WASM build, SDK tests, frontend build, `--locked`, pinned actions | all jobs green and meaningful |
| P3 | L-1–L-6, M-15–M-18 | fmt, docs truthfulness, dead deps, LICENSE, lint configs, real env examples | docs match code |

**Evidence required before submission or release:**
1. Clean `cargo build --target wasm32-unknown-unknown --release` with artifacts, plus `fmt`/`clippy`/`test` in CI.
2. A Deployed Testnet contract ID set with reproducible deploy commands (none exist today; do not fabricate them).
3. Real Testnet transaction hashes for DID register, credential issue, proof verify, and revocation — including negative tests.
4. A written ring-signature specification (scheme, domain separation, nonce/nullifier, rogue-key defence) plus test vectors and independent cryptographic review before any anonymity or conformance claim.
5. `AttestationReceiver.sol` with tests covering unauthorized relayer, replay, duplicate, and finality.
6. Updated README where every claim maps to a passing test or a BLOCKED item marked as such.
7. Zero critical/high dependency advisories, or a signed exception register.

---

## 8. What was not verified

- No live Stellar Testnet or EVM interaction (no keys, RPC access, funded accounts, or deployed contracts). All E2E items are BLOCKED, not passed.
- No GitHub Actions run history was available; the CI assessment is static plus local reproduction of each command.
- No browser/visual verification of the frontend (it does not install or build).
- No penetration testing, fuzzing, or formal verification of any contract.
- No cryptographic review is possible: no scheme is specified and no implementation exists.
- Testnet funding/keys, RPC credentials, and a destination EVM contract are required to move items 1–8 of §2 from BLOCKED to tested.

---

## 9. Remediation log

Implemented after the audit above, in priority order. Every result below was produced by executing the command shown; none is inferred.

### 9.1 Fixed

| Finding | Change | Regression evidence |
|---|---|---|
| **C-1** | `contracts/Cargo.toml`: removed `features = ["testutils"]` from the workspace dependency; enabled only in `[dev-dependencies]` | `cargo build --target wasm32-unknown-unknown --release --locked` → exit 0, three `.wasm` artifacts |
| **C-2** | `verify_credential` no longer accepts arbitrary bytes: fails closed, mutates no state; `verify_ring_stub` removed; `proof_count` (spammable global counter) removed | `tests::test_forged_ring_signature_is_rejected`, `test_verify_rejects_shape_mismatch_and_empty_message` |
| **C-4** | Issuers registered as `Address`; `set_attribute_ring` requires membership; `remove_issuer`, `transfer_admin` added | `test_unregistered_issuer_cannot_set_ring`, `test_non_admin_cannot_add_issuer`, `test_removing_issuer_invalidates_their_credentials` |
| **C-5** | `set_compliance_status` deleted. No caller can assert compliance; it is derived from credentials | `test_subject_cannot_self_certify` |
| **C-6** | `is_compliant` loads the versioned policy and cross-contract calls `is_credential_valid` for every required attribute; unknown policy / unset verifier → `false` | `test_policy_requires_all_attributes`, `test_policy_update_changes_evaluation`, `test_unset_verifier_fails_closed`, `test_unknown_policy_is_not_compliant` |
| **C-7** | Issuer routes require `x-issuer-key`; issuer identity resolved server-side from an out-of-band key map; private keys no longer accepted; `issuerPrivkey` parameter removed | 31 service tests incl. `requires authentication`, `does not accept private key material`, `refuses issues for another issuer's request` |
| **C-8** | Credential retrieval keyed on a one-time `retrievalToken` issued at submission; `userId` is no longer a lookup key; token deleted after read | `does not expose credentials by userId (IDOR regression)`, `one user cannot consume another user's credential` |
| **C-9** | `/api/issuer/requests` returns a redacted projection (`requestId`, `userId`, `attributes`, `status`, `createdAt`, `hasDocument`) | `lists only this issuer's pending requests, redacted` asserts no PII in payload |
| **C-10** | Fabricated `_parseAttestation` removed. Listener uses Soroban RPC `getEvents`, validates contract id/topics/address/policy/boolean, dedupes by event id, persists cursor | 7 listener tests incl. `does not fabricate attestations from unrelated effects`, `emits each event id once` |
| **H-1** | DID id derived as `did:stellar:<strkey>` | `test_did_id_is_derived_from_controller`, `test_resolved_did_contains_controller_strkey` |
| **H-2** | Events emitted for DID register/update/deactivate, issuer add/remove, ring set, credential issue/revoke, policy set, attestation export | same contract test suites exercise these paths |
| **H-3** | Unknown ring returns `false` instead of panicking | `test_verify_unknown_ring_returns_false_without_panic` |
| **H-5** | Credentials carry `expires_at` + `revoked`; `revoke_credential`; de-registering an issuer invalidates its credentials | `test_issue_credential_is_valid_until_expiry`, `test_revoked_credential_is_invalid`, `test_revocation_and_expiry_flip_compliance` |
| **H-6** | Persistent entries TTL-extended on write (and on DID resolve) | covered by all contract tests running against the real host |
| **H-8** | Relayer inspects `receipt.status`; reverts throw instead of being reported as success | `rejects a reverted transaction (regression...)`, `rejects a missing receipt` |
| **H-10** | Listener consumes Soroban RPC events, persists cursor + processed ids | `emits each event id once` |
| **H-11** | Frontend: added `index.html`, `vite.config.ts`, `tsconfig.json`, `src/main.tsx`, lockfile; SDK dependency now `file:../sdk` | `npm ci && npm run build` → exit 0 (38 modules, 167 kB bundle) |
| **H-12** | SDK read paths implemented via simulation (`resolve`, `getAttributeRing`, `isCredentialValid`, `getCredential`, `isCompliant`, `getPolicy`, `exportAttestation`); write paths build prepared unsigned XDR; ring methods throw an explicit, accurate error | 13 SDK tests; `npm test`, `npm run lint`, `npm run build` all exit 0 |
| **H-13** | Non-breaking audit fixes applied; `uuid`/`multer`/`express`-in-bridge removed; `proxy-addr` 2.0.8. Critical advisory eliminated | kyc-issuer 9 → 4 advisories (0 critical, 2 high); sdk 5 → 2 high; bridge 2 high |
| **H-14** | Private key removed from every request schema and from `buildCredential`'s signature | `does not accept private key material` |
| **H-15** | `pending → approved \| rejected` enforced; double transitions return 409 | `cannot be approved twice`, `cannot approve a rejected request`, `cannot reject an already approved request` |
| **M-1** | `document_hash` must be non-empty and ≤ 128 bytes | `test_empty_hash_rejected`, `test_oversized_hash_rejected` |
| **M-2** | Ring size capped at 16 with duplicate-member rejection | `test_empty_ring_rejected`, `test_duplicate_ring_member_rejected` |
| **M-3** | Global `proof_count` counter removed entirely | — |
| **M-4** | `remove_issuer` implemented | `test_removing_issuer_invalidates_their_credentials` |
| **M-6** | CORS allowlist (deny by default), rate limiter on intake, bounded JSON body | `rateLimit` tests (3) |
| **M-7** | Internal error details no longer returned; centralized error handler | — |
| **M-8** | Attribute allowlist + symbol regex, 192-hex pubkey check, userId charset/length, size limits | 8 validation tests |
| **M-9** | Compliance is computed per call; `evaluated_at` is emitted in the attestation | `test_export_attestation_reports_live_state` |
| **M-10** | `jest.config.js`, `eslint.config.mjs`, `@types/jest`, eslint toolchain added | `npm test` / `npm run lint` exit 0 |
| **M-11** | CI now runs fmt, clippy, `test --locked`, WASM build, SDK build/test/lint, bridge tests, frontend build | static review of `.github/workflows/ci.yml` |
| **M-14** | Dead deps and unused imports removed; `.env.example` files rewritten to the variables actually read | `npm ci` succeeds in all packages |
| **M-16** | SDK now has ESLint config; docs no longer claim service/frontend linting | `npm run lint` exit 0 |
| **M-17** | Lockfiles for frontend and bridge added; `engines` declared | `npm ci` in both |
| **L-1** | `cargo fmt --all` applied | `cargo fmt --all -- --check` exit 0 |
| **L-2** | Non-existent `CTRL:<did>` storage documentation removed | — |
| **L-4** | Bridge refuses to start on missing config and no longer logs phantom relays | — |

### 9.2 Still open

| Finding | Reason |
|---|---|
| **C-3** | BLS12-381 remains unavailable. Docs now state this. Fixing it requires upgrading to `soroban-sdk` ≥ 22 **and** choosing/implementing/auditing a ring-signature construction. The feature is disabled rather than faked. |
| **H-4** | Replay/domain-separation work is moot while proofs are disabled. It must be designed with the scheme (domain = contract ‖ network ‖ attribute ‖ subject ‖ nonce ‖ ledger, plus a nullifier). |
| **H-7** | `initialize` is still not atomic with deployment. Documented as a mandatory deploy step; an atomic constructor needs the Protocol 22 SDK. |
| **H-9** | `AttestationReceiver.sol` does not exist. The relayer's signing scheme and ABI are documented but the destination (allowlist, nonce replay protection, finality) is unimplemented. |
| **M-5** | Admin rotation exists; issuer-key compromise containment exists (de-registration). DID key rotation/recovery does not, because identifiers are derived from the controller key. |
| **M-12** | Frontend pages are still placeholders (now buildable). Wiring them to the SDK/API is feature work, not a fix. |
| **M-13** | KYC data is still plaintext in process memory with no retention job. |
| **M-15** | SEP-10/12/45 remain unimplemented (documented as such). |
| **M-18** | Fixed for both `.env.example` files (`[TEMPLATE]` removed). |
| **L-3** | Irreversible deactivation with no recovery — inherent to the identifier-from-key design. |
| **L-5** | `should_panic` substring assertions remain; behaviour is now covered by explicit tests. |
| **L-6** | No `LICENSE` file despite the MIT statement. |
| **H-13 (partial)** | One high advisory remains: `@stellar/stellar-sdk` → `toml`. It requires a **major** SDK upgrade that would change the SDK surface and cannot be validated without network. Not applied rather than applied untested. |

### 9.3 Final verification (re-run after all changes)

| Command | Exit | Result |
|---|---|---|
| `cargo fmt --all -- --check` | **0** | clean |
| `cargo clippy --all-targets --locked -- -D warnings` | **0** | clean |
| `cargo test --locked` | **0** | **41 passed** (did 10, vc 20, compliance 11) |
| `cargo build --target wasm32-unknown-unknown --release --locked` | **0** | 3 WASM artifacts (4.3 kB / 6.7 kB / 21.2 kB) |
| `npm test` (kyc-issuer) | **0** | **31 passed** |
| `npm test` (cross-chain-bridge) | **0** | **12 passed** |
| `npm test` (sdk) | **0** | **13 passed** |
| `npm run lint` (sdk) | **0** | clean |
| `npm run build` (sdk) | **0** | `dist/` emitted |
| `npm ci && npm run build` (frontend) | **0** | built in ~1.6 s |
| `npm audit --omit=dev` (kyc-issuer) | — | 0 critical, 2 high (both the `toml` chain) |
| `npm audit --omit=dev` (sdk / bridge) | — | 2 high (the `toml` chain) |

Test count went from 4 contract + 7 service + 0 SDK + 0 bridge to **41 + 31 + 13 + 12 = 97**.

### 9.4 End-to-end status after remediation

The eight required E2E steps in §2 remain **BLOCKED**. Nothing in this pass deployed to Testnet, funded an account, or contacted an EVM network. What changed is that the contracts now **build**, the code paths **fail closed** instead of accepting forgeries, and the unit/regression coverage exists to test them — not that they have been demonstrated live. Step 3 (valid attribute proof) and step 6 (genuine EVM relay) remain unimplementable until C-3 and H-9 are resolved.
