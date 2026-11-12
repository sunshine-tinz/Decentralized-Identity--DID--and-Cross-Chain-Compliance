# Testnet End-to-End Verification Evidence

**Execution Timestamp:** `2026-11-12T09:36:11.923Z`  
**Script:** `node scripts/verify_remediated_e2e.js`  
**Stellar Network:** Stellar Testnet (`https://soroban-testnet.stellar.org`, `Test SDF Network ; September 2015`)  
**EVM Network:** Local Foundry Anvil EVM (`chainId 31337`) *(public Ethereum Sepolia requires operator `SEPOLIA_RPC_URL` and funded `SEPOLIA_PRIVATE_KEY`)*

---

## 1. Freshly Deployed Remediated Stellar Testnet Contracts

| Contract | Contract ID (StrKey) | WASM SHA-256 | Upload Tx Hash (Ledger) | Deploy Tx Hash (Ledger) |
|---|---|---|---|---|
| **DID Registry** | `CAYT4IOLYKTQWBPYOY7ECIL2EGJMPCNYSGYDUQEQBQU475SU3SKVAXPG` | `35a0ba46e07535d10543e5eaac70cbdc9b913f4f49abc0cb31707e35efc57b93` | `381bdba60aa6a80bf0957cce34aa8dd25cfa4e431e0d60ef8d7142de3fe76936` (`5690507`) | `66504a70b2b6eb63f9d0d74bcb059ef9a736d92254afebacb58d28a95320c72d` (`5690508`) |
| **VC Verifier** | `CDDVO64VECGNVZOKCGTBAEKVB27HE5P4JGZZTMMI5FZIY4SHWF5UM662` | `6a92e4b965d4fb83d9601afe84c0eb494d7691c5405be0819edcb58fe6146924` | `bca919cb77d73fffc33383a8b9fdba3f3c41bb7ffd5001c2c84ecc6b6184bd9f` (`5690509`) | `b5b2a2596752c29f836d2787ff220d8b826d9373309d8605ce4b9f3b999d4afa` (`5690510`) |
| **Compliance Engine** | `CAZAZ3Y7HYVVP2DXWQM5QPJWVCBGO7SUDMVMPZQGNRURYWCYES74PUZW` | `e933b1f4c78b262ba84fb48926297f9c7270f951daaa79dcb6a75ee15f509130` | `0c2bf0bfefc2a481bdc75cf02d99a36c1016086487e26c8cac3cec8b0ea7cee4` (`5690511`) | `8de1987572da3e17bc874c8bec80cb52b24c45950a28172813ee6ba7cf0ffa71` (`5690512`) |

**EVM Receiver (`AttestationReceiver.sol` on Local Anvil `chainId 31337`):**
- **Contract Address:** `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- **Deploy Tx Hash:** `0xfac9d6ade338e3c3fe5b6dbb654c72df69995578630577e1033b5dac922c26c5` (Block `1`)

---

## 2. Executed End-to-End Lifecycle Matrix

| Step | Operation | Network | Transaction Hash | Ledger / Block | Verified Outcome |
|---:|---|---|---|---|---|
| 1 | `VCVerifier.initialize` | Stellar Testnet | `55e8966c9f117d299751ce6b8da0e05da94896ecd73ed7ab19b578540789fdaf` | Ledger `5690513` | `SUCCESS` |
| 2 | `ComplianceEngine.initialize` | Stellar Testnet | `35c3402b95cf5a0c864365156a1dc8439d06796618c7f07c7df5b1f0043424d3` | Ledger `5690514` | `SUCCESS` |
| 3 | `ComplianceEngine.set_verifier` | Stellar Testnet | `0aba73a8d155a66b20ed3b9e9f6d968d61a141f16a76def2180ee203a3d93b5b` | Ledger `5690515` | `SUCCESS` |
| 4 | `VCVerifier.add_issuer` | Stellar Testnet | `266fdcd0707af0abe570cada97b508e694ce58afb2fc6a0631409444f8a64156` | Ledger `5690516` | `SUCCESS` |
| 5 | `ComplianceEngine.set_policy` (`defi_pool`) | Stellar Testnet | `7f59d9b773a6d278f44c3b6c10e2b5bbf907da0da5323b550c65ec342e007de7` | Ledger `5690517` | `SUCCESS` |
| 6 | `DIDRegistry.register` | Stellar Testnet | `2afedcfaf28a36a48b383581906f5ec9a2914e3041fa8cb5a79007a70a82d861` | Ledger `5690518` | Created `did:stellar:GDDV6LUB5VW3NJWYTW2KPJTMPQA4HXNI22VEFCZDEAZZ2GUHOZRK7ER7` |
| 7 | `DIDRegistry.rotate_controller` | Stellar Testnet | `5229808c95eb7aeef1b079c386f83af1cab3a8779a72e5ee9cdbcff576dadb8a` | Ledger `5690519` | Controller rotated to `GCQM5DQC...`; DID ID preserved |
| 8 | `DIDRegistry.set_recovery` | Stellar Testnet | `64c2545a79fe868f9f8f8e77a14849acfbe0189843692aa1eb51f0f69a2e7cae` | Ledger `5690520` | Guardian `GAOR4QER...` configured |
| 9 | `DIDRegistry.recover` | Stellar Testnet | `2d1fd2f9060cc6445243a50972f604b2884784967678ac92ea75f658c5662f66` | Ledger `5690521` | Guardian recovered controller back to `GDDV6LUB...` |
| 10 | SEP-10 Auth + Encrypted KYC + `issue_credential` | Stellar Testnet + KYC API | `c2cbfb41647d491be429515d175056da0aae9286a51fc1b21a440afd0cd321e1` | Expires `6208921` | W3C VC (`Ed25519Signature2020`) issued & retrieved once |
| 11 | `ComplianceEngine.export_attestation` (`true`) | Stellar Testnet | `7a448f40a534b8941cf2a324bbfe18e9a8f0db3b7c22d215ba745efc9f0b522f` | Ledger `5690523` | Event `0024440610182193152-0000000000` emitted |
| 12 | Bridge `receiveAttestation` (`compliant=true`) | Anvil EVM (`31337`) | `0xbd7de4cbaa9a6593bfd62053d164d3cc228a09f31161557d6d97db8ae26971d2` | Block `2` | `isCompliant == true`, `consumedNonce == true` |
| 13 | `VCVerifier.revoke_credential` | Stellar Testnet | `1337221a461146bc7d8c51f77993c5b16499f8560690b3226951e1abc486651a` | Ledger `5690524` | Stellar `is_compliant` flipped to `false` |
| 14 | `ComplianceEngine.export_attestation` (`false`) | Stellar Testnet | `8c84ca9bb3023dd4df2a7d6ca198f36a1fb77a6ec5f17fac34187c90bab2baeb` | Ledger `5690525` | Event `0024440618772090880-0000000000` emitted |
| 15 | Bridge `receiveAttestation` (`compliant=false`) | Anvil EVM (`31337`) | `0x86fb714814de5861621c93dfdca97ef615c4298fa0d35420acfa8d2add598cc1` | Block `3` | EVM `isCompliant` flipped to `false`; older ledger `5690523` attestation reverted |

---

## 3. Explicit External Boundaries

- **Public Ethereum Sepolia Broadcast:** Not executed because no operator `SEPOLIA_RPC_URL` or gas-funded `SEPOLIA_PRIVATE_KEY` was supplied in this environment.
- **Interactive Browser Freighter Extension:** Tested via mocked `@stellar/freighter-api` in Vitest; manual click-through in Chrome/Brave with Freighter installed remains an interactive browser verification step.
