# Production Readiness Roadmap

**Repository:** `sunshine-tinz/Decentralized-Identity--DID--and-Cross-Chain-Compliance`  
**Updated:** 2026-11-12

---

## 1. Completed in This Remediation

1. **Frontend Wallet & RPC Pipeline:** Integrated `@stellar/freighter-api`, added `submitSignedTransaction` finality polling in `@stellar-did/sdk`, fixed `VerifyPage.tsx` `subject` submission + SEP-10 auth flow, and removed hardcoded wallet fallbacks.
2. **Cross-Chain Bridge Hardening:** Built dual-signature `IdentityRegistry` (`G...` ↔ `0x...`), durable `EventQueue` with exponential backoff & crash recovery, and fixed live Soroban RPC `getEvents` parsing (`Contract` object + base64 topics).
3. **EVM Security & Foundry Tests:** Upgraded `AttestationReceiver.sol` to EIP-712 + low-`s` + expiry + monotonic `stellarLedger` ordering + safe relayer rotation + 2-step ownership, verified with 10 Foundry EVM tests.
4. **KYC Security & Privacy Controls:** Added AES-256-GCM PII encryption with key rotation, SEP-10 authentication & subject ownership enforcement, retention sweeps, `DELETE` endpoint, and compensating `revokeCredential` rollback.
5. **DID & VC Standards Progress:** Added DID key rotation/recovery with ID continuity, W3C DID Core resolver, and `Ed25519Signature2020` W3C Verifiable Credential generation & verification.
6. **CI/CD Gates:** Added Foundry EVM tests, frontend ESLint, WASM artifact uploads, dependency audit gates, and secret scanning.

---

## 2. Migration Notes (Legacy Testnet Instances → Remediated Contracts)

Existing legacy Testnet contracts (`CBPKUC...`, `CABOIS...`, `CAZSHQ...`) do not expose `rotate_controller`, `recover`, `resolve_by_id`, `set_services`, or `issue_credential_anchored`. Configurations now point to the newly deployed remediated Testnet contracts:
- `DID_REGISTRY`: `CAYT4IOLYKTQWBPYOY7ECIL2EGJMPCNYSGYDUQEQBQU475SU3SKVAXPG`
- `VC_VERIFIER`: `CDDVO64VECGNVZOKCGTBAEKVB27HE5P4JGZZTMMI5FZIY4SHWF5UM662`
- `COMPLIANCE_ENGINE`: `CAZAZ3Y7HYVVP2DXWQM5QPJWVCBGO7SUDMVMPZQGNRURYWCYES74PUZW`

---

## 3. Remaining Work Before Mainnet Production

1. **Zero-Knowledge Privacy Proofs (Phase 9 Evaluation):**
   - Current workspace pins `soroban-sdk 21.x` (no CAP-0059 BLS12-381 host functions).
   - **Recommended target:** Upgrade to `soroban-sdk >= 22` (Protocol 22+ CAP-0059) and adopt either **BBS+ selective disclosure** (no trusted setup, W3C VC Data Integrity BBS Cryptosuite) or **Groth16/PLONK over BLS12-381** with nullifier tracking and an independent cryptographic audit.
2. **KYC Persistence & Key Management:** Replace in-memory `Map` storage with encrypted PostgreSQL + KMS/Vault envelope encryption and Redis-backed distributed rate limiting.
3. **Relayer Decentralization & Public Sepolia Broadcast:** Replace single-key EVM relayer with threshold signing (e.g. Safe/TSS committee) and run live deploy + `forge verify-contract` on public Ethereum Sepolia (`scripts/demonstrate_sepolia_bridge.js` with `SEPOLIA_RPC_URL`, funded `SEPOLIA_PRIVATE_KEY`, and `ETHERSCAN_API_KEY`) to verify the public-to-public cross-chain bridge path before Mainnet.
4. **Rust SDK Host-VM Upgrade:** All Node.js dependency advisories are resolved (`0 vulnerabilities` across all 4 packages via `@stellar/stellar-sdk@17.4.0`, `vitest@5.1.0`, `vite@8.3.8`, `react-router-dom@7.18.5`); schedule a future `soroban-sdk` upgrade (`21.x → >=22`) alongside CAP-0059 to retire the `soroban-env-host` `crypto-bigint v0.5.5` (`RUSTSEC-2026-0387`) dev/host warning.
5. **External Standards Conformance & Security Audit:** Run W3C DID Core / VC test suites and commission a third-party audit prior to handling real user PII or Mainnet assets.
