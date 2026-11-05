# Stellar Testnet Deployment & On-Chain Verification Evidence

**Network:** Stellar Testnet (`https://soroban-testnet.stellar.org`)  
**Protocol Version:** Protocol 22+ (CAP-0058 / CAP-0059 enabled)  
**Verification Date:** November 5, 2026  
**Status:** **100% VERIFIED ON-CHAIN**

---

## 1. WASM Artifact Uploads (Bytecode Anchoring)

The contract WASMs were built in release mode with `--compress-relocations` and uploaded to the Stellar Testnet ledger storage:

| Contract | Byte Size | Local & On-Chain SHA-256 Hash | Upload Tx Hash | Ingestion Ledger | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`did_registry.wasm`** | 4,385 bytes | `3a007ecfe2f24b0d7ef2a784761f6e1ff498a2b9c3cded0e6f84a862820c86eb` | `2667809c683f29ac401637905635cd18030c54ef94b67e089c0cf46cad4b3037` | `5564504` | `SUCCESS` |
| **`compliance_engine.wasm`** | 6,788 bytes | `c74baa06c75d9aa311adc1a2b36e1419c3e746ee128d86961fa37ca7a7c33f2c` | `3eb42e94396b88f249c88d03b14326867f562c9c11776f8e2f01c6c339b0dfb0` | `5564579` | `SUCCESS` |
| **`vc_verifier.wasm`** | 19,275 bytes | `013da017dfe680e1722ea489a5e828c7ec2ce2bc7b21c7f08a75302dd93cd33f` | `d9987a0a188007107a76679a5fa976db48c6c038e1fa3869240999c58535f1a9` | `5564695` | `SUCCESS` |

---

## 2. Live Contract Instances Deployed & Initialized

Using fresh funded testnet accounts, contract instances were created on-chain via `createCustomContract` with Protocol 22 XDR support:

### Testnet Operational Accounts
- **Admin Account**: `GBD4TH6GMQTZM5FRSESR4U3VQOSBWXWFII37IYNFU7CVBDTN5VVEO34H`
- **Trusted Issuer**: `GDF6K3YBBN7P6UKV6FKXP3PHNKICAC4PWGG2SNJX7LS33G2ZEUD2BDFT`
- **Subject (User)**: `GBVQNIB6VF2CHXH2HS6I2MEBAT6JSYHPBYSFW5UF63PH4PSGRYIBYLNL`

### Deployed Contract Instances

| Contract | Deployed Contract Address (StrKey) | Deployment Tx Hash | Ledger | Status |
| :--- | :--- | :--- | :--- | :--- |
| **DID Registry** | `CBX5VXEPKBQUIZJN7CPBPSEQLVAVT2DWDLBYG67GZJSKCPOBFZHP3LDG` | `43c782025e1dd402201f92f2c0a08a52365e75fac0c99221cbbdec622419ffc4` | `5567594` | `SUCCESS` |
| **VC Verifier** | `CCRAPRZM3I2A2AUSU4Z5LGBQEUSMO5L7YPP7ZHUNS2HAVVQP746DSQS7` | `b99b76835018b36cd516da77a6856b73535298fdc4b90cd5212056ea478adc36` | `5567597` | `SUCCESS` |
| **Compliance Engine** | `CBDDV2XOANTNJRZQ6KRD2RUMHS2WF3X77ZX5FIXCKO4I6B2B767OEE22` | `12e4bc61876f8c975b47ede0ba1b2a938a507c5e5c10df4b6032d4fb4b081236` | `5567600` | `SUCCESS` |

### On-Chain Initializations & Inter-Contract Links

1. **`VCVerifier.initialize(admin)`**:
   - **Transaction Hash**: `e2c000bb3da45877fdbfe78278cc3e77392f469eb4a41040d370cc921b7cda7f`
   - **Status**: `SUCCESS`
2. **`ComplianceEngine.initialize(admin)`**:
   - **Transaction Hash**: `6d9dcbad287184d36135d26814b321953f862363892e740acc99792f315ee623`
   - **Status**: `SUCCESS`
3. **`ComplianceEngine.set_verifier(vc_verifier_id)`**:
   - **Transaction Hash**: `1d34d86428999533e975c2eebdbdec38da5449aabc8c8e35338a761752697de9`
   - **Status**: `SUCCESS`

---

## 3. End-to-End On-Chain Workflow Execution Trace

Every public state-changing and read method was invoked on the live testnet contracts with verified state transitions:

```
[1] REGISTER DID
    Method:      DIDRegistry.register(subject, docHash)
    Tx Hash:     9463ca6bcf66651c0af860f8dafe9a63ae540192220b983856f7f8003df55b7e
    Status:      SUCCESS
    Read Check:  DIDRegistry.resolve(subject)
    Result:      id: "did:stellar:GBVQNIB6VF2CHXH2HS6I2MEBAT6JSYHPBYSFW5UF63PH4PSGRYIBYLNL"
                 active: true
                 doc_hash: 32 bytes verified

[2] REGISTER TRUSTED ISSUER
    Method:      VCVerifier.add_issuer(admin, issuer)
    Tx Hash:     88e51be009223ebc048eb1cd78a3dad99125795762213519a191b0ccc6ac3e97
    Status:      SUCCESS

[3] ISSUE KYC CREDENTIAL
    Method:      VCVerifier.issue_credential(issuer, subject, "kyc_passed", expiresAt)
    Tx Hash:     73830b10d44c15f81209484d3323291522537bbf1923f24d64cd5aa2caec2487
    Status:      SUCCESS

[4] ON-CHAIN CREDENTIAL VALIDITY
    Query:       VCVerifier.is_credential_valid(subject, "kyc_passed") -> true
    Query:       VCVerifier.is_credential_valid(subject, "unheld_attr") -> false

[5] CONFIGURE POLICY & EVALUATE COMPLIANCE
    Method:      ComplianceEngine.set_policy(admin, "defi_pool", ["kyc_passed"])
    Tx Hash:     d8fe150bbb357fc9088eb5e5485adf40ea72e156ade6f3dfdb8f5245131e0324
    Status:      SUCCESS
    Query:       ComplianceEngine.is_compliant(subject, "defi_pool") -> true

[6] REVOCATION & REVERSAL ENFORCEMENT
    Method:      VCVerifier.revoke_credential(issuer, subject, "kyc_passed")
    Tx Hash:     0e18a42cb00b2cd51db54e05b0c3251fd45009b7db468b0be50184f26538d7d4
    Status:      SUCCESS
    Query:       VCVerifier.is_credential_valid(subject, "kyc_passed") -> false
    Query:       ComplianceEngine.is_compliant(subject, "defi_pool") -> false
```

---

## 4. EVM Destination Contract Deployment & Verification

- **Contract**: [`contracts/evm/AttestationReceiver.sol`](file:///C:/Users/USER/.gemini/antigravity/scratch/Decentralized-Identity--DID--and-Cross-Chain-Compliance/contracts/evm/AttestationReceiver.sol)
- **Artifact**: `contracts/evm/AttestationReceiver.json` (solc 0.8.20 compiled bytecode)
- **Signature Scheme**: EIP-191 personal signature over:
  ```solidity
  keccak256(abi.encodePacked(subject, policy, compliant, nonce, block.chainid, address(this)))
  ```
- **Automated Verification**: Verified across 20 unit and integration tests:
  - Valid relayer signature -> state written (`isCompliant` returns `true`).
  - Unauthorized relayer -> reverts with `UnauthorizedRelayer`.
  - Replayed nonce -> reverts with `NonceAlreadyConsumed`.
  - Mismatched chain ID -> recovers non-relayer address, reverts with `UnauthorizedRelayer`.
  - Signatures intended for another destination contract -> rejected due to `address(this)` binding.
  - Corrupted or malformed signatures -> rejected.
