# Stellar Testnet Deployment & Lifecycle Verification

**Network:** Stellar Testnet (`https://soroban-testnet.stellar.org`)  
**Protocol Version:** Protocol 22+ (CAP-0058 / CAP-0059 enabled)  
**Verification Method:** Direct JSON-RPC Query & Live Transaction Submission  
**Verification Timestamp:** 2026-11-05T07:12:29Z  

---

## 1. Local WASM Bytecode vs On-Chain Anchors

All three contracts were compiled in release mode using `wasm32-unknown-unknown` with `--compress-relocations` and uploaded to the Stellar Testnet ledger storage:

| Contract | Byte Size | Local SHA-256 Hash | Upload Tx Hash | Ingestion Ledger | Status | Explorer Link |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`did_registry.wasm`** | 4,385 B | `da3cc052e4652462c59579842b2290961f807f7c69d6b3bdf55fbae7429720d0` | `4dbd76107b4d0c4a92994518850749c063ca3ffe54681f35ca34cfd3c9362707` | `5567764` | `SUCCESS` | [View Tx](https://stellar.expert/explorer/testnet/tx/4dbd76107b4d0c4a92994518850749c063ca3ffe54681f35ca34cfd3c9362707) |
| **`compliance_engine.wasm`** | 6,788 B | `a748176dd25d338e1f34d9a6f5d7387a5a53839094de57424976b0c89c406919` | `64ea5ac7d744e51f9710738f15c4e24f7a832ff4cb47b890c9350be8ad1b22ee` | `5567766` | `SUCCESS` | [View Tx](https://stellar.expert/explorer/testnet/tx/64ea5ac7d744e51f9710738f15c4e24f7a832ff4cb47b890c9350be8ad1b22ee) |
| **`vc_verifier.wasm`** | 19,275 B | `013da017dfe680e1722ea489a5e828c7ec2ce2bc7b21c7f08a75302dd93cd33f` | `d47e8f39fee7200eedbc985b084f498c68cf00cac9c2d631b483fe4fb7e25135` | `5567768` | `SUCCESS` | [View Tx](https://stellar.expert/explorer/testnet/tx/d47e8f39fee7200eedbc985b084f498c68cf00cac9c2d631b483fe4fb7e25135) |

*(Historical uploads from prior session: `did_registry.wasm` in Tx `2667809c683f29ac401637905635cd18030c54ef94b67e089c0cf46cad4b3037` [Ledger 5564504], `compliance_engine.wasm` in Tx `3eb42e94396b88f249c88d03b14326867f562c9c11776f8e2f01c6c339b0dfb0` [Ledger 5564579], `vc_verifier.wasm` in Tx `d9987a0a188007107a76679a5fa976db48c6c038e1fa3869240999c58535f1a9` [Ledger 5564695]).*

---

## 2. Deployed Contract Instances & Initializations

Independent deployment and instantiation was performed on Stellar Testnet using fresh accounts funded via Friendbot.

### Deployed Contract Instances (Active Testnet Configuration)

| Contract Name | Contract Address (StrKey) | Deployment Tx Hash | Ledger | Status | Explorer Link |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DID Registry** | `CBPKUCAYGAFRKXKHRLLG7KZXCHQAGYRQLIGKPXOGLCZGZTMV5JN3SBBX` | `54bfa3691912e8ef747bbd060d76d2893941910553dacb2c9c78ccf67628f680` | `5567781` | `SUCCESS` | [View Contract](https://stellar.expert/explorer/testnet/contract/CBPKUCAYGAFRKXKHRLLG7KZXCHQAGYRQLIGKPXOGLCZGZTMV5JN3SBBX) |
| **VC Verifier** | `CABOISTOEOYKQY46U2TU57DXOGLTQRTUB5THLS2ICMYXMDF2SA7L3UPJ` | `bca2b66ca1dea03ee0b5ca2379393494b82419bda10323685cb8cd0e49356437` | `5567784` | `SUCCESS` | [View Contract](https://stellar.expert/explorer/testnet/contract/CABOISTOEOYKQY46U2TU57DXOGLTQRTUB5THLS2ICMYXMDF2SA7L3UPJ) |
| **Compliance Engine** | `CAZSHQLBCHWVCALAN4SNI3MB2IVD4UNS6PCZ763LK47N6IU3YCOP73TA` | `a6609c28837c031c681c8e77826dd16f0532ea775e106e8059df05229cbb5572` | `5567789` | `SUCCESS` | [View Contract](https://stellar.expert/explorer/testnet/contract/CAZSHQLBCHWVCALAN4SNI3MB2IVD4UNS6PCZ763LK47N6IU3YCOP73TA) |

*(Historical contract instances from prior audit sessions: DID `CBX5VXEPKBQUIZJN7CPBPSEQLVAVT2DWDLBYG67GZJSKCPOBFZHP3LDG` [Ledger 5567594], VC `CCRAPRZM3I2A2AUSU4Z5LGBQEUSMO5L7YPP7ZHUNS2HAVVQP746DSQS7` [Ledger 5567597], and Compliance `CBDDV2XOANTNJRZQ6KRD2RUMHS2WF3X77ZX5FIXCKO4I6B2B767OEE22` [Ledger 5567600]).*

### Initializations & Inter-Contract Links
- **`VCVerifier.initialize`**: Tx [`3dc71f7fc818d95e4c09077baae4db1005fa1ee721050040c6bfbbd044d5a05b`](https://stellar.expert/explorer/testnet/tx/3dc71f7fc818d95e4c09077baae4db1005fa1ee721050040c6bfbbd044d5a05b) (Ledger `5567792`)
- **`ComplianceEngine.initialize`**: Tx [`7c1f46982fcb05d4c836230c7bfb7129f9b0558a8b8aaf5cbe18e9c1894e7529`](https://stellar.expert/explorer/testnet/tx/7c1f46982fcb05d4c836230c7bfb7129f9b0558a8b8aaf5cbe18e9c1894e7529) (Ledger `5567794`)
- **`ComplianceEngine.set_verifier`**: Tx [`ef1ce652a9f1f30c411901c735d3f551935c6cb12fc09c7d7f1a0dba32839a9d`](https://stellar.expert/explorer/testnet/tx/ef1ce652a9f1f30c411901c735d3f551935c6cb12fc09c7d7f1a0dba32839a9d) (Ledger `5567798`)

---

## 3. End-to-End Contract Lifecycle Verification Trace

Each public method was executed live on the fresh contract instances:

### 1. DID Registration & Resolution
- **Invocation**: `DIDRegistry.register(subject, docHash)`
- **Transaction**: [`e94cf1b9005e48b43b6ab9818a10da3cd54b8362038ee0de5a114cb18220a759`](https://stellar.expert/explorer/testnet/tx/e94cf1b9005e48b43b6ab9818a10da3cd54b8362038ee0de5a114cb18220a759) (Ledger `5567800`)
- **On-Chain Read**: `DIDRegistry.resolve(subject)`
  - **Returned ID**: `did:stellar:GACJNK7HOWTVCFJXT5WZSWIG6IOU27DYCOCIJIL7GUU4ERQCOLKAGJXT`
  - **Returned Active Status**: `true`
  - **Result**: **PASS**

### 2. Trusted Issuer Registration
- **Invocation**: `VCVerifier.add_issuer(admin, issuer)`
- **Transaction**: [`cd57a443dd8fda40575b069b9e0c0334e19bd0d4daf286bfc519735c2429f5d9`](https://stellar.expert/explorer/testnet/tx/cd57a443dd8fda40575b069b9e0c0334e19bd0d4daf286bfc519735c2429f5d9) (Ledger `5567805`)
- **Result**: **PASS**

### 3. Credential Issuance & Validity Query
- **Invocation**: `VCVerifier.issue_credential(issuer, subject, "kyc_passed", expiresAt)`
- **Transaction**: [`5ce0c9ff4a71c1d449e732631ef02b83c40121b3fb12a61182fc4735eb50c625`](https://stellar.expert/explorer/testnet/tx/5ce0c9ff4a71c1d449e732631ef02b83c40121b3fb12a61182fc4735eb50c625) (Ledger `5567810`)
- **On-Chain Query**: `VCVerifier.is_credential_valid(subject, "kyc_passed")`
  - **Returned Value**: `true`
  - **Result**: **PASS**

### 4. Compliance Policy Registration & Multi-Attribute Evaluation
- **Invocation**: `ComplianceEngine.set_policy(admin, "defi_pool", ["kyc_passed"])`
- **Transaction**: [`97b509712921c4eac1f9f8085c3bc30cd56f3aa3cffbd54e4a5cc625f87ef49a`](https://stellar.expert/explorer/testnet/tx/97b509712921c4eac1f9f8085c3bc30cd56f3aa3cffbd54e4a5cc625f87ef49a) (Ledger `5567814`)
- **On-Chain Query**: `ComplianceEngine.is_compliant(subject, "defi_pool")`
  - **Returned Value**: `true`
  - **Result**: **PASS**

### 5. Credential Revocation & Post-Revocation Enforcement
- **Invocation**: `VCVerifier.revoke_credential(issuer, subject, "kyc_passed")`
- **Transaction**: [`9191a8698c6c4f279bc9275644d06e7a43929810a1b12b3e468ddcd738abadb7`](https://stellar.expert/explorer/testnet/tx/9191a8698c6c4f279bc9275644d06e7a43929810a1b12b3e468ddcd738abadb7) (Ledger `5567818`)
- **On-Chain Read 1**: `VCVerifier.is_credential_valid(subject, "kyc_passed")`
  - **Returned Value**: `false`
- **On-Chain Read 2**: `ComplianceEngine.is_compliant(subject, "defi_pool")`
  - **Returned Value**: `false`
  - **Result**: **PASS** (Revocation immediately flips downstream compliance to false).
