# Final Stellar Testnet Live Verification Report

**Network:** Stellar Testnet (`https://soroban-testnet.stellar.org`)  
**Network Passphrase:** `Test SDF Network ; September 2015`  
**Protocol Version:** Protocol 22+ (CAP-0058 / CAP-0059 enabled)  
**Verification Method:** Direct JSON-RPC `getTransaction` and contract simulation on live network  
**Verification Timestamp:** 2026-11-06T08:08:14Z  
**Verification Status:** **100% VERIFIED LIVE ON STELLAR TESTNET (14/14 Transactions Successful)**

---

## 1. Active Deployed Contracts

The following three contracts are deployed, initialized, linked, and currently active in repository configurations (`frontend/src/config.ts`, `frontend/.env.example`, `sdk/src/index.ts`, `README.md`):

| Contract | Active Contract Address (StrKey) | Deployment Tx Hash | Ledger | Status | Explorer Link |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DID Registry** | `CBPKUCAYGAFRKXKHRLLG7KZXCHQAGYRQLIGKPXOGLCZGZTMV5JN3SBBX` | `54bfa3691912e8ef747bbd060d76d2893941910553dacb2c9c78ccf67628f680` | 5567781 | `SUCCESS` | [View Contract](https://stellar.expert/explorer/testnet/contract/CBPKUCAYGAFRKXKHRLLG7KZXCHQAGYRQLIGKPXOGLCZGZTMV5JN3SBBX) |
| **VC Verifier** | `CABOISTOEOYKQY46U2TU57DXOGLTQRTUB5THLS2ICMYXMDF2SA7L3UPJ` | `bca2b66ca1dea03ee0b5ca2379393494b82419bda10323685cb8cd0e49356437` | 5567784 | `SUCCESS` | [View Contract](https://stellar.expert/explorer/testnet/contract/CABOISTOEOYKQY46U2TU57DXOGLTQRTUB5THLS2ICMYXMDF2SA7L3UPJ) |
| **Compliance Engine** | `CAZSHQLBCHWVCALAN4SNI3MB2IVD4UNS6PCZ763LK47N6IU3YCOP73TA` | `a6609c28837c031c681c8e77826dd16f0532ea775e106e8059df05229cbb5572` | 5567789 | `SUCCESS` | [View Contract](https://stellar.expert/explorer/testnet/contract/CAZSHQLBCHWVCALAN4SNI3MB2IVD4UNS6PCZ763LK47N6IU3YCOP73TA) |

*(Historical contract instances from initial verification session: DID `CBX5VXEPKBQUIZJN7CPBPSEQLVAVT2DWDLBYG67GZJSKCPOBFZHP3LDG` [Ledger 5567594], VC `CCRAPRZM3I2A2AUSU4Z5LGBQEUSMO5L7YPP7ZHUNS2HAVVQP746DSQS7` [Ledger 5567597], and Compliance `CBDDV2XOANTNJRZQ6KRD2RUMHS2WF3X77ZX5FIXCKO4I6B2B767OEE22` [Ledger 5567600]).*

---

## 2. On-Chain Bytecode Anchors (WASM Uploads)

Release WASM binaries compiled with `-C link-arg=--compress-relocations` were uploaded and verified against local hashes:

| WASM Module | Byte Size | SHA-256 Hash | Full Tx Hash | Ledger | Status | Explorer Link |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `did_registry.wasm` | 4,385 B | `da3cc052e4652462c59579842b2290961f807f7c69d6b3bdf55fbae7429720d0` | `4dbd76107b4d0c4a92994518850749c063ca3ffe54681f35ca34cfd3c9362707` | 5567764 | `SUCCESS` | [View Tx](https://stellar.expert/explorer/testnet/tx/4dbd76107b4d0c4a92994518850749c063ca3ffe54681f35ca34cfd3c9362707) |
| `compliance_engine.wasm` | 6,788 B | `a748176dd25d338e1f34d9a6f5d7387a5a53839094de57424976b0c89c406919` | `64ea5ac7d744e51f9710738f15c4e24f7a832ff4cb47b890c9350be8ad1b22ee` | 5567766 | `SUCCESS` | [View Tx](https://stellar.expert/explorer/testnet/tx/64ea5ac7d744e51f9710738f15c4e24f7a832ff4cb47b890c9350be8ad1b22ee) |
| `vc_verifier.wasm` | 19,275 B | `013da017dfe680e1722ea489a5e828c7ec2ce2bc7b21c7f08a75302dd93cd33f` | `d47e8f39fee7200eedbc985b084f498c68cf00cac9c2d631b483fe4fb7e25135` | 5567768 | `SUCCESS` | [View Tx](https://stellar.expert/explorer/testnet/tx/d47e8f39fee7200eedbc985b084f498c68cf00cac9c2d631b483fe4fb7e25135) |

---

## 3. Live Transaction Verification Audit Matrix

Every reported transaction was queried directly via Soroban RPC `getTransaction`:

| # | Operation Name | Method / Event | Full Transaction Hash | Ledger | Status | Explorer Link |
| :-: | :--- | :--- | :--- | :-: | :-: | :--- |
| 1 | `did_upload` | `UploadWasm` | `4dbd76107b4d0c4a92994518850749c063ca3ffe54681f35ca34cfd3c9362707` | 5567764 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/4dbd76107b4d0c4a92994518850749c063ca3ffe54681f35ca34cfd3c9362707) |
| 2 | `comp_upload` | `UploadWasm` | `64ea5ac7d744e51f9710738f15c4e24f7a832ff4cb47b890c9350be8ad1b22ee` | 5567766 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/64ea5ac7d744e51f9710738f15c4e24f7a832ff4cb47b890c9350be8ad1b22ee) |
| 3 | `vc_upload` | `UploadWasm` | `d47e8f39fee7200eedbc985b084f498c68cf00cac9c2d631b483fe4fb7e25135` | 5567768 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/d47e8f39fee7200eedbc985b084f498c68cf00cac9c2d631b483fe4fb7e25135) |
| 4 | `did_deploy` | `CreateContract` | `54bfa3691912e8ef747bbd060d76d2893941910553dacb2c9c78ccf67628f680` | 5567781 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/54bfa3691912e8ef747bbd060d76d2893941910553dacb2c9c78ccf67628f680) |
| 5 | `vc_deploy` | `CreateContract` | `bca2b66ca1dea03ee0b5ca2379393494b82419bda10323685cb8cd0e49356437` | 5567784 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/bca2b66ca1dea03ee0b5ca2379393494b82419bda10323685cb8cd0e49356437) |
| 6 | `comp_deploy` | `CreateContract` | `a6609c28837c031c681c8e77826dd16f0532ea775e106e8059df05229cbb5572` | 5567789 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/a6609c28837c031c681c8e77826dd16f0532ea775e106e8059df05229cbb5572) |
| 7 | `vc_init` | `initialize` | `3dc71f7fc818d95e4c09077baae4db1005fa1ee721050040c6bfbbd044d5a05b` | 5567792 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/3dc71f7fc818d95e4c09077baae4db1005fa1ee721050040c6bfbbd044d5a05b) |
| 8 | `comp_init` | `initialize` | `7c1f46982fcb05d4c836230c7bfb7129f9b0558a8b8aaf5cbe18e9c1894e7529` | 5567794 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/7c1f46982fcb05d4c836230c7bfb7129f9b0558a8b8aaf5cbe18e9c1894e7529) |
| 9 | `set_verifier`| `set_verifier` | `ef1ce652a9f1f30c411901c735d3f551935c6cb12fc09c7d7f1a0dba32839a9d` | 5567798 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/ef1ce652a9f1f30c411901c735d3f551935c6cb12fc09c7d7f1a0dba32839a9d) |
| 10| `register_did`| `register` | `e94cf1b9005e48b43b6ab9818a10da3cd54b8362038ee0de5a114cb18220a759` | 5567800 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/e94cf1b9005e48b43b6ab9818a10da3cd54b8362038ee0de5a114cb18220a759) |
| 11| `add_issuer` | `add_issuer` | `cd57a443dd8fda40575b069b9e0c0334e19bd0d4daf286bfc519735c2429f5d9` | 5567805 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/cd57a443dd8fda40575b069b9e0c0334e19bd0d4daf286bfc519735c2429f5d9) |
| 12| `issue_cred` | `issue_credential` | `5ce0c9ff4a71c1d449e732631ef02b83c40121b3fb12a61182fc4735eb50c625` | 5567810 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/5ce0c9ff4a71c1d449e732631ef02b83c40121b3fb12a61182fc4735eb50c625) |
| 13| `set_policy` | `set_policy` | `97b509712921c4eac1f9f8085c3bc30cd56f3aa3cffbd54e4a5cc625f87ef49a` | 5567814 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/97b509712921c4eac1f9f8085c3bc30cd56f3aa3cffbd54e4a5cc625f87ef49a) |
| 14| `revoke_cred`| `revoke_credential`| `9191a8698c6c4f279bc9275644d06e7a43929810a1b12b3e468ddcd738abadb7` | 5567818 | **SUCCESS** | [View Tx](https://stellar.expert/explorer/testnet/tx/9191a8698c6c4f279bc9275644d06e7a43929810a1b12b3e468ddcd738abadb7) |

---

## 4. Query Verification & Lifecycle Trace

1. **DID Resolution**:
   - `DIDRegistry.resolve(subject)` returned:
     - `id`: `did:stellar:GACJNK7HOWTVCFJXT5WZSWIG6IOU27DYCOCIJIL7GUU4ERQCOLKAGJXT`
     - `active`: `true`
     - `document_hash`: `32 bytes verified`
2. **Post-Issuance Validity**:
   - `VCVerifier.is_credential_valid(subject, "kyc_passed")` returned `true`.
3. **Compound Compliance Check**:
   - `ComplianceEngine.is_compliant(subject, "defi_pool")` returned `true`.
4. **Post-Revocation Enforcement**:
   - `VCVerifier.is_credential_valid(subject, "kyc_passed")` returned `false`.
   - `ComplianceEngine.is_compliant(subject, "defi_pool")` returned `false`.

---

## 5. Independent Reproduction

Auditors can independently re-verify all 14 active Testnet transactions using the included script:
```bash
node scripts/verify_live_testnet_txs.js
```
The script queries the official Stellar Testnet RPC and validates the status of each transaction in seconds.
