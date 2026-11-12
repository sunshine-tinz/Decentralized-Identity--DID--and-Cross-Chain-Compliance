# Stellar DID & Cross-Chain Compliance

**Status: Remediated Testnet Prototype — 122 automated tests passing (56 Soroban, 10 Foundry EVM, 16 KYC Issuer, 13 Cross-Chain Bridge, 17 SDK, 10 Frontend), 0 `npm audit` vulnerabilities across all Node.js packages, and live Stellar Testnet + local Foundry Anvil EVM verification.**

This repository contains Soroban contracts for DID anchoring, key rotation, and guardian recovery (`did_registry`), issuer-attested credentials (`vc_verifier`), and live compliance evaluation (`compliance_engine`); an EIP-712 hardened EVM receiver ([`AttestationReceiver.sol`](contracts/evm/AttestationReceiver.sol)); a SEP-10 authenticated & AES-256-GCM encrypted KYC issuer service; a durable Stellar → EVM bridge with dual-signed identity mapping; a TypeScript SDK (`@stellar-did/sdk` built on `@stellar/stellar-sdk@^17.4.0`); and a React dApp with Freighter wallet transaction signing and RPC finality polling.

---

## Deployed Stellar Testnet Contracts (Remediated)

| Contract | Address | Explorer Link |
|---|---|---|
| **DID Registry** | `CAYT4IOLYKTQWBPYOY7ECIL2EGJMPCNYSGYDUQEQBQU475SU3SKVAXPG` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CAYT4IOLYKTQWBPYOY7ECIL2EGJMPCNYSGYDUQEQBQU475SU3SKVAXPG) |
| **VC Verifier** | `CDDVO64VECGNVZOKCGTBAEKVB27HE5P4JGZZTMMI5FZIY4SHWF5UM662` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDDVO64VECGNVZOKCGTBAEKVB27HE5P4JGZZTMMI5FZIY4SHWF5UM662) |
| **Compliance Engine** | `CAZAZ3Y7HYVVP2DXWQM5QPJWVCBGO7SUDMVMPZQGNRURYWCYES74PUZW` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CAZAZ3Y7HYVVP2DXWQM5QPJWVCBGO7SUDMVMPZQGNRURYWCYES74PUZW) |

---

## Verification & Audit Reports

| Document | Scope |
|---|---|
| [`FINAL_REMEDIATION_REPORT.md`](FINAL_REMEDIATION_REPORT.md) | Issue-by-issue remediation log and post-edit test results (122/122) |
| [`UPDATED_ACCEPTANCE_STATUS.md`](UPDATED_ACCEPTANCE_STATUS.md) | Honest status ledger (`FIXED` / `PARTIALLY FIXED` / `NOT FIXED`) |
| [`SECURITY_AUDIT_REPORT.md`](SECURITY_AUDIT_REPORT.md) | Security controls, dependency audit, and residual risks |
| [`TESTNET_END_TO_END_EVIDENCE.md`](TESTNET_END_TO_END_EVIDENCE.md) | Live Stellar Testnet + Anvil EVM transaction hashes and ledgers |
| [`PRODUCTION_READINESS_ROADMAP.md`](PRODUCTION_READINESS_ROADMAP.md) | Migration notes and remaining Mainnet hardening milestones |
| [`REMAINING_BLOCKERS.md`](REMAINING_BLOCKERS.md) | Explicit open blockers and external boundaries |

---

## Quick Start

Requires Rust (`contracts/rust-toolchain.toml`), Foundry (`forge` / `anvil`), and Node.js ≥ 20.

```bash
# 1. Soroban Contracts & Rust Dependency Audit
cd contracts
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked --lib
cargo build --target wasm32-unknown-unknown --release --locked
cargo audit --ignore RUSTSEC-2026-0387 --ignore RUSTSEC-2024-0436

# 2. EVM Receiver Contract (Foundry)
cd evm && forge test -vv

# 3. KYC Issuer Service
cd ../../services/kyc-issuer && npm ci && npm test && npm audit

# 4. Cross-Chain Bridge
cd ../cross-chain-bridge && npm ci && npm test && npm audit

# 5. SDK & Frontend
cd ../../sdk && npm ci && npm run build && npm test && npm run lint && npm audit
cd ../frontend && npm ci && npm run lint && npm test -- --run && npm run build && npm audit

# 6. End-to-End Verification Scripts
cd ..
node scripts/verify_remediated_e2e.js       # Live Stellar Testnet + local Anvil (chainId 31337)
node scripts/demonstrate_sepolia_bridge.js # Local EIP-712 checks + Sepolia deploy/verify when SEPOLIA_RPC_URL & SEPOLIA_PRIVATE_KEY are set
```

---

## Security, Standards & Audit Posture

- **Frontend & Wallet Pipeline:** Uses official `@stellar/freighter-api`, `submitSignedTransaction` finality polling in `@stellar-did/sdk` (including JSON-RPC fallback compatibility), strict Stellar `subject` validation on KYC intake, and post-confirmation on-chain state refresh.
- **KYC Privacy & Security Controls:** PII and uploaded documents are encrypted at rest with AES-256-GCM and multi-key rotation (`KYC_ENCRYPTION_KEYS`), protected by SEP-10 challenge/JWT subject ownership (`req.user.account === subject`), single-use retrieval PII scrubbing, automatic expiration (`purgeExpired`), `DELETE /api/kyc/request/:requestId`, issuer-to-signer key matching, and compensating `revokeCredential` rollback on partial batch failures. *(Production deployment requires replacing the in-memory `Map` store with an encrypted DB + KMS/Vault.)*
- **Cross-Chain Bridge & EVM Receiver:** Enforces dual-signature (Ed25519 + EIP-191) `IdentityRegistry` bindings (`G...` ↔ `0x...`), durable `EventQueue` retries/crash recovery, EIP-712 typed-data signatures (`StellarComplianceBridge` v1) with EIP-2 low-`s`, expiration checks, single-use nonces, strictly monotonic `stellarLedger` ordering, safe relayer rotation, and 2-step ownership transfer in [`AttestationReceiver.sol`](contracts/evm/AttestationReceiver.sol).
- **DID Core & Verifiable Credentials:** `DIDRegistry` supports `rotate_controller`, `recover`, and `set_services` with immutable `did:stellar:` identifiers; `@stellar-did/sdk` provides `resolveW3CDID`, and both `kyc-issuer` and the SDK sign/validate/verify `Ed25519Signature2020` W3C VC JSON-LD envelopes backed by live Soroban status & digest checks.
- **Dependency & CI Hygiene:** All 4 Node.js packages pass `npm audit` with **0 vulnerabilities** (`@stellar/stellar-sdk@^17.4.0`, `vitest@^5.1.0`, `vite@^8.3.8`, `react-router-dom@^7.18.5`). In Rust (`contracts/Cargo.lock`), `spin` is updated to `0.9.9` (zero yanked crates); host-only `RUSTSEC-2026-0387` (`crypto-bigint v0.5.5`) and `RUSTSEC-2024-0436` (`paste v1.0.15`) are verified absent from `--target wasm32-unknown-unknown` and remain gated on an upstream `stellar/rs-soroban-env` upgrade to `elliptic-curve 0.14+`. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) enforces Foundry EVM tests, `cargo-audit`, `wasm32` exclusion checks, strict `npm audit`, frontend ESLint, WASM artifacts, and tracked-secret scanning.
- **Privacy / Zero-Knowledge (`NOT FIXED` — Fail-Closed):** `VCVerifier::verify_credential` remains **disabled (`false`)** because `soroban-sdk 21.x` lacks CAP-0059 host functions and no audited ZK/BBS+ circuit is implemented. All active credentials and compliance checks are public.
- **Remaining External Milestones Before Mainnet:** Public Ethereum Sepolia deployment + Etherscan verification (`SEPOLIA_RPC_URL`, funded `SEPOLIA_PRIVATE_KEY`, optional `ETHERSCAN_API_KEY`), durable KYC DB/KMS persistence, external W3C/browser QA, and an independent third-party security audit.

## License

MIT
