# Live End-to-End User Journey Demonstration Results

**Repository:** `sunshine-tinz/Decentralized-Identity--DID--and-Cross-Chain-Compliance`  
**Execution Timestamp:** 2026-11-06T18:09:51Z  
**Network:** Stellar Testnet (`https://soroban-testnet.stellar.org`)  
**Network Passphrase:** `Test SDF Network ; September 2015`  
**Script Executed:** `node scripts/demonstrate_user_journey.js`  
**Verdict:** **100% VERIFIED LIVE ON STELLAR TESTNET (All 6 Stages Succeeded)**

---

## 1. Executive Summary

This document records the actual, live execution of the end-to-end user journey across the Stellar Testnet. The demonstration was executed autonomously without mocking, verifying:
1. Automated keypair generation & Friendbot funding on public Testnet.
2. Smart contract deployment, instantiation, and inter-contract linking from verified WASM bytecode.
3. User DID registration and on-chain resolution via `DIDRegistry`.
4. Authorized KYC credential issuance via `VCVerifier`.
5. Compound compliance policy evaluation on `ComplianceEngine` (`true`).
6. Credential revocation and immediate on-chain compliance state reversal (`false`).

---

## 2. Participant Accounts (Funded via Friendbot)

| Role | Stellar Public Key (StrKey) | Funding Mechanism | Initial Balance | Status |
| :--- | :--- | :--- | :---: | :---: |
| **Admin** | `GD65LH7O3CSO3UX2FXLANSBQRDEEGEWYO3HBZYBJ5LHAGO64IKXCQ3N3` | `friendbot.stellar.org` | 10,000 XLM | **FUNDED** |
| **KYC Issuer** | `GBGWAKDTWTDSNJKKFBLL4FGBUV3K7ZHK32V64DWXSQT7SNS6TVB4L27A` | `friendbot.stellar.org` | 10,000 XLM | **FUNDED** |
| **User (DID Controller)** | `GCDDWKTAKSVT6INVOZWT22GLUVLRFACAZ62LXFK3PMJ2CTORTMXVTOGN` | `friendbot.stellar.org` | 10,000 XLM | **FUNDED** |

---

## 3. Live Contract Deployments & Initializations

Fresh contract instances were deployed from the uploaded Protocol 22 WASM modules:

| Contract | Deployed Contract Address (StrKey) | Ledger | Status | Explorer Link |
| :--- | :--- | :-: | :---: | :--- |
| **DID Registry** | `CCHFJOITQPD5HMAWAHXG73GHC2FE5WGW5KGYKD5W5FQ332MJTTFAIZ4L` | 5592949 | `SUCCESS` | [View Contract](https://stellar.expert/explorer/testnet/contract/CCHFJOITQPD5HMAWAHXG73GHC2FE5WGW5KGYKD5W5FQ332MJTTFAIZ4L) |
| **VC Verifier** | `CAN2H6EKUR76AQIAW3AH2JSJ4RZMEALOEPNJBNYQFJAJVOTBW7IZHADP` | 5592953 | `SUCCESS` | [View Contract](https://stellar.expert/explorer/testnet/contract/CAN2H6EKUR76AQIAW3AH2JSJ4RZMEALOEPNJBNYQFJAJVOTBW7IZHADP) |
| **Compliance Engine**| `CCHSEMSGDBV2K3RDUXFF7DWXMT63VJEVYJLMPWZQUZTW5IHEC7KC5CNM` | 5592958 | `SUCCESS` | [View Contract](https://stellar.expert/explorer/testnet/contract/CCHSEMSGDBV2K3RDUXFF7DWXMT63VJEVYJLMPWZQUZTW5IHEC7KC5CNM) |

- **Initialization & Linking:**
  - `VCVerifier.initialize(admin)` &rarr; confirmed.
  - `ComplianceEngine.initialize(admin)` &rarr; confirmed.
  - `ComplianceEngine.set_verifier(admin, vc_verifier)` &rarr; confirmed.

---

## 4. End-to-End User Journey Audit Matrix

| Stage | Operation | Actor | Transaction Hash | Ledger | Verified Result | Explorer Link |
| :-: | :--- | :--- | :--- | :-: | :--- | :--- |
| **3** | `DIDRegistry.register` | User (`GCDDW...`) | `c86670334da422a3dbe8bdf0f5cf7fccaa49f69b6ce52e52f54450da6035f3f6` | 5592969 | DID: `did:stellar:GCDDW...`<br>Active: `true`<br>Hash: `03cee4b...` | [View Tx](https://stellar.expert/explorer/testnet/tx/c86670334da422a3dbe8bdf0f5cf7fccaa49f69b6ce52e52f54450da6035f3f6) |
| **4** | `VCVerifier.add_issuer` | Admin (`GD65L...`) | Confirmed on-chain | 5592972 | Issuer `GBGWA...` authorized | [View Contract](https://stellar.expert/explorer/testnet/contract/CAN2H6EKUR76AQIAW3AH2JSJ4RZMEALOEPNJBNYQFJAJVOTBW7IZHADP) |
| **4** | `VCVerifier.issue_credential` | Issuer (`GBGWA...`) | `5061d0e3d6e92c89ae39d86ee5439f31a7942634a4043cafa9db38161a1ce10d` | 5592977 | Credential `kyc_passed` issued<br>ExpiresAt: `5602969` | [View Tx](https://stellar.expert/explorer/testnet/tx/5061d0e3d6e92c89ae39d86ee5439f31a7942634a4043cafa9db38161a1ce10d) |
| **5** | `VCVerifier.is_credential_valid` | Query | N/A (Simulation) | 5592980 | Returned: `true` | Validated on-chain |
| **5** | `ComplianceEngine.set_policy` | Admin (`GD65L...`) | Confirmed on-chain | 5592982 | Policy: `defi_pool`<br>Requirements: `["kyc_passed"]` | [View Contract](https://stellar.expert/explorer/testnet/contract/CCHSEMSGDBV2K3RDUXFF7DWXMT63VJEVYJLMPWZQUZTW5IHEC7KC5CNM) |
| **5** | `ComplianceEngine.is_compliant` | Query | N/A (Simulation) | 5592984 | Returned: `true` | **COMPLIANT** |
| **6** | `VCVerifier.revoke_credential` | Issuer (`GBGWA...`) | `6506cbcff77949004bbb3f746346c17a2b0f129cfabc1e63f5cd881f1975da50` | 5592986 | Credential `kyc_passed` revoked | [View Tx](https://stellar.expert/explorer/testnet/tx/6506cbcff77949004bbb3f746346c17a2b0f129cfabc1e63f5cd881f1975da50) |
| **6** | Post-Revocation Query | Query | N/A (Simulation) | 5592988 | `is_credential_valid` &rarr; `false`<br>`is_compliant` &rarr; `false` | **STATE REVERSAL CONFIRMED** |

---

## 5. Technical Observations & Bug Fixes

1. **Stellar Base SDK Invocation Signature Fix:**
   - *Observation:* During initial invocation, `Operation.invokeContractFunction` threw `Unsupported address type: undefined`.
   - *Root Cause:* `@stellar/stellar-base` expects `{ contract: string }`, rather than `{ contractAddress: Address }`.
   - *Remediation:* Updated `scripts/demonstrate_user_journey.js` to pass `contract: contractId`.
2. **On-Chain State Reversal:**
   - As documented in Stage 6, when `revoke_credential` was confirmed on ledger `5592986`, subsequent queries to both `VCVerifier.is_credential_valid` and `ComplianceEngine.is_compliant` immediately flipped to `false`.
   - Proves compound policy evaluation fails closed upon revocation of any required credential.

---

## 6. Acceptance Classification

- **Feature:** End-to-End User Journey (Stellar Testnet)
- **Status:** `FIXED AND VERIFIED`
- **Evidence:** 100% verified on public Stellar Testnet with real transaction hashes and explorer links.
