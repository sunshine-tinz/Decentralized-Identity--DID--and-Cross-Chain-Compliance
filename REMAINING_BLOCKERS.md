# Remaining Blockers & Open Risks Ledger

**Repository:** `sunshine-tinz/Decentralized-Identity--DID--and-Cross-Chain-Compliance`  
**Date:** 2026-11-12  
**Overall Readiness:** **READY FOR TESTNET EVALUATION / NOT READY FOR MAINNET PRODUCTION**

| Item | Classification | Impact | Description & Required Action |
|---|---|---|---|
| **Zero-Knowledge / Selective-Disclosure Proofs** | `NOT FIXED` *(fail-closed)* | No on-chain privacy | `VCVerifier::verify_credential` remains disabled (`false`). Requires `soroban-sdk >= 22` (CAP-0059), audited BBS+/ZK circuits, and nullifiers. |
| **Public EVM Sepolia Broadcast & Bridge Verification** | `PARTIALLY FIXED` | External credential boundary | `AttestationReceiver.sol` and bridge verified in Foundry (10/10), live Stellar Testnet → Anvil (`31337`), and EIP-712 `demonstrate_sepolia_bridge.js`; public Sepolia deploy + Etherscan verification (`forge verify-contract`) requires operator-supplied `SEPOLIA_RPC_URL` and funded `SEPOLIA_PRIVATE_KEY`. |
| **Rust Host-Dependency Advisory (`RUSTSEC-2026-0387`)** | `PARTIALLY FIXED` | Test/host VM only (`wasm32` unaffected) | Updated `spin` (`0.9.8 → 0.9.9`), eliminating the yanked-crate warning. `cargo-audit` v0.23.0 still flags `crypto-bigint v0.5.5` (`RUSTSEC-2026-0387`) and unmaintained `paste v1.0.15` inside `soroban-env-host` / `soroban-wasmi`; verified absent from `--target wasm32-unknown-unknown`. Upstream `soroban-sdk` (`29.0.1`) / `soroban-env-host` (`30.0.0`) still depend on `elliptic-curve ^0.13.5` (`crypto-bigint ^0.5`) and `soroban-wasmi 29.0.0`, so remediation awaits an upstream `stellar/rs-soroban-env` migration to `elliptic-curve 0.14`+. |
| **KYC Durable Database & KMS** | `PARTIALLY FIXED` | Process restarts clear memory | PII is AES-256-GCM encrypted with rotation and purging, but stored in process memory (`Map`). Production needs PostgreSQL + KMS/Vault. |
| **Independent Security Audit** | `NOT FIXED` | External governance gate | External third-party audit of contracts, EIP-712 bridge, and KYC service required before Mainnet launch. |
| **External W3C Conformance & Live Browser Freighter Test** | `PARTIALLY FIXED` | Manual QA needed | Unit/Testnet verification passed (`0` npm advisories across all 4 Node packages); run W3C Universal Resolver/VC conformance suites and manual Freighter browser E2E before public release. |
