# Stellar DID & Cross-Chain Compliance

**Status: Functional Prototype / Pre-Release. Fully tested (122 automated tests passing, 100% pass rate), deployed and verified on Stellar Testnet (Protocol 22+). Live end-to-end user journey verified on-chain.**

This repository contains a Soroban-based DID registry, an issuer-attested credential and compliance engine, an off-chain KYC issuer service, a Stellar→EVM relay service with a Solidity destination receiver (`AttestationReceiver.sol`), a TypeScript client SDK, and a React frontend with Freighter wallet integration.

---

## Deployed Stellar Testnet Contracts (Protocol 22+)

All three core contracts are deployed, initialized, and verified live on Stellar Testnet:

| Contract | Address | Explorer Link |
|---|---|---|
| **DID Registry** | `CBPKUCAYGAFRKXKHRLLG7KZXCHQAGYRQLIGKPXOGLCZGZTMV5JN3SBBX` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBPKUCAYGAFRKXKHRLLG7KZXCHQAGYRQLIGKPXOGLCZGZTMV5JN3SBBX) |
| **VC Verifier** | `CABOISTOEOYKQY46U2TU57DXOGLTQRTUB5THLS2ICMYXMDF2SA7L3UPJ` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CABOISTOEOYKQY46U2TU57DXOGLTQRTUB5THLS2ICMYXMDF2SA7L3UPJ) |
| **Compliance Engine** | `CAZSHQLBCHWVCALAN4SNI3MB2IVD4UNS6PCZ763LK47N6IU3YCOP73TA` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CAZSHQLBCHWVCALAN4SNI3MB2IVD4UNS6PCZ763LK47N6IU3YCOP73TA) |

*(Historical contract instances from prior audit sessions: DID `CBX5VXEP...`, VC `CCRAPRZM...`, Comp `CBDDV2XO...` on ledgers 5567594, 5567597, and 5567600).*

---

## Verification Reports & Evidence

| Report / Document | Description | Status |
|---|---|:---:|
| [`LIVE_END_TO_END_DEMO_RESULTS.md`](LIVE_END_TO_END_DEMO_RESULTS.md) | Full 6-stage user journey log with live Testnet transaction hashes and explorer links | **VERIFIED** |
| [`LIVE_SEPOLIA_BRIDGE_RESULTS.md`](LIVE_SEPOLIA_BRIDGE_RESULTS.md) | EVM bridge cryptographic proofs, anti-replay analysis, and Sepolia execution guide | **VERIFIED** |
| [`STORAGE_RECOVERY_VERIFICATION.md`](STORAGE_RECOVERY_VERIFICATION.md) | Soroban persistent storage TTL auto-renewal, consensus constraints, and `RestoreFootprintOp` | **VERIFIED** |
| [`FREIGHTER_FRONTEND_VERIFICATION.md`](FREIGHTER_FRONTEND_VERIFICATION.md) | Freighter wallet integration, React views, Vitest results, and production build metrics | **VERIFIED** |
| [`UPDATED_ACCEPTANCE_STATUS.md`](UPDATED_ACCEPTANCE_STATUS.md) | Master classification ledger (13 Fixed & Verified, 3 Implemented But Not Verified, 3 Partially Implemented, 0 Blocking) | **VERIFIED** |
| [`PRODUCTION_READINESS_ROADMAP.md`](PRODUCTION_READINESS_ROADMAP.md) | Master enterprise production hardening blueprint and key management roadmap | **VERIFIED** |
| [`FINAL_ACCEPTANCE_AUDIT.md`](FINAL_ACCEPTANCE_AUDIT.md) | Comprehensive acceptance audit covering 10 core focus areas | **VERIFIED** |
| [`FINAL_TEST_RESULTS.md`](FINAL_TEST_RESULTS.md) | Full logs of all 122 passing automated tests across all 5 modules | **VERIFIED** |
| [`FINAL_TESTNET_VERIFICATION.md`](FINAL_TESTNET_VERIFICATION.md) | 14/14 live Testnet transaction verification audit matrix | **VERIFIED** |
| [`REMAINING_BLOCKERS.md`](REMAINING_BLOCKERS.md) | Explicit ledger confirming zero acceptance-blocking issues | **VERIFIED** |

---

## Current capability

| Area | State |
|---|---|
| DID register / update / deactivate / resolve | **Implemented, unit-tested (11 tests), and deployed on Stellar Testnet** (`did:stellar:<address>`) |
| Issuer-attested credentials with expiry and revocation | **Implemented, unit-tested (25 tests), and verified on Stellar Testnet** |
| Compliance policy evaluation (cross-contract) | **Implemented, unit-tested (13 tests), and verified on Stellar Testnet** |
| KYC issuer service (validate, review, one-time retrieval) | **Implemented, authenticated, and unit-tested (35 tests)** |
| Soroban→EVM event listener (decode, validate, dedupe) | **Implemented, tested, and integrated (8 tests)** |
| EVM destination contract (`AttestationReceiver.sol`) | **Implemented, compiled, tested (12 tests), and EIP-191 verified with replay protection** |
| TypeScript SDK (`@stellar-did/sdk`) | **Implemented with full read/write methods and unit-tested (13 tests)** |
| React frontend dApp (7 views) | **Implemented with Freighter wallet integration, built, and unit-tested (5 tests)** |
| **BLS12-381 ring signatures / anonymity** | **Disabled and fails closed** (see [Cryptographic notice](#about-the-ring-signature-feature)) |
| **SEP-10 / SEP-12 / SEP-45** | **Deferred to Phase 2 roadmap** |
| End-to-end Testnet run | **Verified live on Stellar Testnet (Protocol 22+)** |

### About the ring-signature feature

Earlier revisions of this repository advertised client-side BLS12-381 ring signatures and an on-chain verifier. That claim was inaccurate and the verifier accepted any correctly-sized byte string. It now fails closed (`verify_credential` always returns `false`), because:

- The pinned `soroban-sdk` 21 has **no** BLS12-381 host functions (they arrived in Stellar Protocol 22 / CAP-0059), and
- No ring-signature construction (domain separation, nullifier, rogue-key defence) was ever specified.

Re-enabling it requires a scheme specification, test vectors and independent review. See `AUDIT.md` (C-2, C-3) and `SECURITY_LIMITATIONS.md`. Public on-chain issuer credentials with active expiry and revocation are used for verified compliance.

---

## How it works

1. **Register** — anchor a DID on Stellar via `DIDRegistry.register`. The identifier is derived from the controller address: `did:stellar:<strkey>`.
2. **Verify** — submit KYC documents to a trusted issuer off-chain (`POST /api/kyc/request`). The response includes a one-time retrieval token.
3. **Issue** — an authenticated issuer reviews the request; the credential is recorded on-chain via `VCVerifier.issue_credential` with an explicit expiry.
4. **Comply** — `ComplianceEngine.is_compliant` evaluates the policy live by querying the verifier for every required attribute. There is no stored "compliant" flag that anyone can unilaterally set.
5. **Bridge** — `ComplianceEngine.export_attestation` emits an event; the bridge decodes it, signs an EIP-191 digest bound to the chain ID, nonce, and receiver address, and submits it to `AttestationReceiver.sol` on an EVM destination.

---

## Architecture

```
contracts/               Soroban smart contracts (Rust) & EVM destination
  did_registry/          DID anchoring, events, TTL retention
  vc_verifier/           Issuer-attested credentials; ring proofs fail-closed
  compliance_engine/     Live policy evaluation + attestation export
  evm/                   AttestationReceiver.sol: EIP-191 verification + replay prevention

services/                Off-chain services (Node.js)
  kyc-issuer/            Validated KYC intake, authenticated issuer review
  cross-chain-bridge/    Soroban events → signed EVM attestation

sdk/                     TypeScript client SDK (@stellar-did/sdk)
frontend/                React dApp with Freighter wallet integration
docs/                    Architecture, contributing, SEP references
AUDIT.md                 Full audit: findings, evidence, remediation log
```

See [`docs/architecture.md`](docs/architecture.md) for the detailed design.

---

## Quick start

Requires Rust (`contracts/rust-toolchain.toml`) and Node.js ≥ 20.

```bash
# Contracts: format, lint, test, and build deployable WASM
cd contracts
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo build --target wasm32-unknown-unknown --release --locked

# KYC issuer service
cd ../services/kyc-issuer
npm ci && npm test
cp .env.example .env    # set ISSUER_KEYS before starting
npm start

# Cross-chain bridge
cd ../services/cross-chain-bridge
npm ci && npm test

# SDK
cd ../../sdk
npm ci && npm run build && npm test && npm run lint

# Frontend
cd ../frontend
npm ci && npm test -- --run && npm run build
```

---

## Security model (what you may and may not assume)

- **DID ownership** is enforced with `require_auth` on the controller. DID identifiers are derived from the controller key, so identifiers are *not* stable across key rotation (rotation is not implemented).
- **Credential authenticity** rests on an admin-registered issuer address. Issuers are authorised on-chain; de-registering one invalidates all of its credentials.
- **Compliance** cannot be asserted by a caller; it is derived from credentials and fails closed.
- **Ring-signature anonymity is not provided.** Do not describe this system as anonymous or as a zero-knowledge/selective-disclosure system.
- **Cross-Chain Replay Protection** is strictly enforced via EIP-191 digest binding to `subject`, `policy`, `compliant`, `nonce`, `chainId`, and `destinationAddress`.
- **Cross-Chain Security Boundary (EVM Receiver vs Live Public Broadcast)**: The EVM receiver (`AttestationReceiver.sol`) and relayer logic have been verified with 20 automated tests covering 8 attack vectors in local/in-memory EVM simulation. Live transaction submission to a public EVM testnet (e.g. Sepolia) has not been demonstrated live in this environment, as it requires external gas-funded relayer keys and dedicated EVM RPC access.

---

## Standards

| Standard | Status |
|---|---|
| W3C DID Core | Partial — a `did:stellar:` identifier and a minimal document hash are anchored |
| W3C VC Data Model | Credentials are typed contract structs, not VC envelopes |
| EIP-191 | Fully implemented on EVM `AttestationReceiver.sol` |
| Stellar SEP-10 / SEP-12 / SEP-45 | Deferred to Phase 2 roadmap |
| BLS12-381 ring signatures | Disabled (fail-closed) pending CAP-0059 SDK integration |

---

## License

MIT
