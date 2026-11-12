# Updated Acceptance Status Ledger

**Repository:** `sunshine-tinz/Decentralized-Identity--DID--and-Cross-Chain-Compliance`  
**Evaluation Date:** 2026-11-12  
**Testnet Verification:** Live Stellar Testnet + Local Foundry Anvil EVM (`scripts/verify_remediated_e2e.js`)

---

## 1. Capability Classification

Classifications strictly follow evidence standards:
- **FIXED:** Code changed and relevant unit/EVM/E2E verification passed.
- **PARTIALLY FIXED:** Implementation and unit tests exist, but production infrastructure or external conformance/network verification remains outstanding.
- **NOT FIXED:** Feature remains unimplemented or intentionally disabled.

| Capability | Classification | Verification Evidence |
|---|---|---|
| Soroban Contract Authorization & Fail-Closed Logic | **FIXED** | 56/56 contract unit tests pass (including `MockAuth` negative auth checks); deployed live on Stellar Testnet |
| Foundry EVM Bytecode Verification (`AttestationReceiver.sol`) | **FIXED** | 10/10 Foundry `forge test -vv` tests pass against compiled bytecode (EIP-712, low-`s`, replay, expiry, monotonic ledger, rotation) |
| Cross-Chain Identity Mapping & Durable Queue | **FIXED** | Dual-signature `IdentityRegistry` + `EventQueue` backoff/recovery; 13/13 bridge tests pass + live Stellar Testnet → Anvil relay verified |
| Frontend Wallet & Transaction Submission | **FIXED** | `@stellar/freighter-api` integrated, `submitSignedTransaction` polls RPC finality; 10/10 Vitest + ESLint + `vite build` pass *(live browser Freighter click-through requires interactive browser)* |
| KYC Encryption, SEP-10 Auth & PII Lifecycle | **PARTIALLY FIXED** | AES-256-GCM + key rotation, SEP-10 challenge/JWT, `DELETE` endpoint, compensating rollback pass 16/16 tests; in-memory store requires external DB/KMS for production |
| W3C DID Core Compatibility & Rotation/Recovery | **PARTIALLY FIXED** | On-chain `rotate_controller`, `recover`, `set_services`, and SDK `resolveW3CDID` verified on Testnet & SDK tests; external Universal Resolver conformance suite not run |
| W3C Verifiable Credentials Interoperability | **PARTIALLY FIXED** | `Ed25519Signature2020` signing, schema validation, revocation/expiry checks, and on-chain `vc_hash` anchoring pass SDK & KYC tests; external W3C VC test suite not run |
| Public EVM Testnet (Sepolia) Live Broadcast | **PARTIALLY FIXED** | Verified on local Foundry Anvil EVM (`chainId 31337`); public Sepolia broadcast blocked on operator-supplied `SEPOLIA_RPC_URL` and funded `SEPOLIA_PRIVATE_KEY` |
| Zero-Knowledge / BLS12-381 Privacy Proofs | **NOT FIXED** | Intentionally disabled (`verify_credential` returns `false`). `soroban-sdk` 21 lacks CAP-0059 host functions and no audited ZK/BBS+ circuit is implemented |
| Node.js `npm audit` Dependency Advisories | **FIXED** | Upgraded `@stellar/stellar-sdk` to `^17.4.0`, `react-router-dom` to `^7.18.5`, `vite` to `^8.3.8`, `vitest` to `^5.1.0`; `npm audit` reports **0 vulnerabilities** across all 4 Node packages and CI enforces `npm audit` |
| Rust `cargo-audit` & `soroban-env-host` Findings | **PARTIALLY FIXED** | Updated `spin` (`0.9.8 → 0.9.9`) eliminating the yanked warning. `crypto-bigint v0.5.5` (`RUSTSEC-2026-0387`) and `paste v1.0.15` remain strictly inside test/host VM dependencies (`soroban-env-host` / `soroban-wasmi`, absent from `--target wasm32-unknown-unknown`). Verified on crates.io that even `soroban-sdk 29.0.1` / `soroban-env-host 30.0.0` still pin `elliptic-curve ^0.13.5` (`crypto-bigint ^0.5`). Enforced in CI via `--target wasm32-unknown-unknown` exclusion check + `cargo audit`. |
| Independent Third-Party Security Audit | **NOT FIXED** | External human cryptographic and smart-contract review must be commissioned prior to Mainnet |
