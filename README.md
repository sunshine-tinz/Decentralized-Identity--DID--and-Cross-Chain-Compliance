# Stellar DID & Cross-Chain Compliance

**Status: Remediated Testnet Prototype — 122 automated tests passing (56 Soroban, 10 Foundry EVM, 16 KYC Issuer, 13 Cross-Chain Bridge, 17 SDK, 10 Frontend). Live end-to-end Stellar Testnet + local Foundry Anvil EVM verification executed.**

This repository contains Soroban contracts for DID anchoring/rotation/recovery (`did_registry`), issuer-attested credentials (`vc_verifier`), and live compliance evaluation (`compliance_engine`), an EIP-712 hardened EVM receiver (`contracts/evm/AttestationReceiver.sol`), a SEP-10 authenticated & AES-256-GCM encrypted KYC issuer service, a durable Stellar→EVM bridge with dual-signed identity mapping, a TypeScript SDK (`@stellar-did/sdk`), and a React dApp with Freighter integration.

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
# 1. Soroban Contracts
cd contracts
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked --lib
cargo build --target wasm32-unknown-unknown --release --locked

# 2. EVM Receiver Contract (Foundry)
cd evm && forge test -vv

# 3. KYC Issuer Service
cd ../../services/kyc-issuer && npm ci && npm test

# 4. Cross-Chain Bridge
cd ../cross-chain-bridge && npm ci && npm test

# 5. SDK & Frontend
cd ../../sdk && npm ci && npm run build && npm test && npm run lint
cd ../frontend && npm ci && npm run lint && npm test -- --run && npm run build
```

---

## Security & Standards Posture

- **Privacy / Zero-Knowledge:** Ring-signature verification in `VCVerifier::verify_credential` is **disabled and fails closed** (`false`). All active on-chain credentials and compliance checks are public; do not advertise ZK anonymity.
- **DID Core & Key Continuity:** `DIDRegistry` supports `rotate_controller`, `recover`, `set_services`, and immutable `did:stellar:` identifiers; `@stellar-did/sdk` provides `resolveW3CDID`.
- **Verifiable Credentials:** `kyc-issuer` and `@stellar-did/sdk` produce and verify `Ed25519Signature2020` W3C VC JSON-LD envelopes backed by live Soroban status checks.
- **Cross-Chain Bridge:** Uses authenticated dual-signature `IdentityRegistry` (`G...` ↔ `0x...`), durable `EventQueue` retries, and EIP-712 verification with low-`s`, expiration, nonce replay protection, and monotonic `stellarLedger` ordering in `AttestationReceiver.sol`.

## License

MIT
