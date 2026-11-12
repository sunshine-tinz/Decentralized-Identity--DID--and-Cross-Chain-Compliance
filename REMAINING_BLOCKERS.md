# Remaining Blockers & Open Risks Ledger

**Repository:** `sunshine-tinz/Decentralized-Identity--DID--and-Cross-Chain-Compliance`  
**Date:** 2026-11-12  
**Overall Readiness:** **READY FOR TESTNET EVALUATION / NOT READY FOR MAINNET PRODUCTION**

| Item | Classification | Impact | Description & Required Action |
|---|---|---|---|
| **Zero-Knowledge / Selective-Disclosure Proofs** | `NOT FIXED` *(fail-closed)* | No on-chain privacy | `VCVerifier::verify_credential` remains disabled (`false`). Requires `soroban-sdk >= 22` (CAP-0059), audited BBS+/ZK circuits, and nullifiers. |
| **Public EVM Sepolia Broadcast** | `PARTIALLY FIXED` | External credential boundary | `AttestationReceiver.sol` and bridge verified in Foundry (10/10) and live Stellar Testnet → Anvil (`31337`); public Sepolia requires `SEPOLIA_RPC_URL` and funded `SEPOLIA_PRIVATE_KEY`. |
| **KYC Durable Database & KMS** | `PARTIALLY FIXED` | Process restarts clear memory | PII is AES-256-GCM encrypted with rotation and purging, but stored in process memory (`Map`). Production needs PostgreSQL + KMS/Vault. |
| **Major-Version Dependency Advisories** | `NOT FIXED` *(documented)* | Dev/transitive exposure | `@stellar/stellar-sdk <=15.1.0` (`toml` high), `vitest 1.x` (`tinypool` critical, dev-only), `react-router-dom 6.x` (`moderate`) require breaking major upgrades. |
| **External W3C Conformance & Live Browser Freighter Test** | `PARTIALLY FIXED` | Manual QA needed | Unit/Testnet verification passed; run W3C Universal Resolver/VC conformance suites and manual Freighter browser E2E before public release. |
