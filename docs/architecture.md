# Architecture

## Overview

This project implements a privacy-preserving Decentralized Identity (DID) and cross-chain compliance system on Stellar. It enables users to prove KYC/AML attributes (e.g. "kyc_passed", "accredited_investor") without revealing their identity, and propagates compliance status to EVM chains so users don't need to re-verify on every network.

## Prior Art

| Project | Chain | Approach | What we borrow |
|---|---|---|---|
| **Polygon ID** | Ethereum/Polygon | ZK-proof DIDs + VCs (Iden3 protocol), W3C standard | W3C DID/VC data model, selective disclosure concept |
| **KILT Protocol** | Polkadot | Cross-chain DID via Decentralized Identity Provider (DIP), portable identities across parachains | 3-actor model (provider / consumer / user), cross-chain identity portability |
| **Chainlink ACE** | Multi-chain | Modular compliance engine, CCIP for cross-chain relay, DECO (TLS-based ZKP) for privacy | Modular policy engine, cross-chain attestation relay pattern |
| **Civic** | Ethereum | Reusable KYC credentials, on-chain verification | Reusable credential concept |

Our approach adapts these patterns to Stellar's unique primitives: Soroban smart contracts, BLS12-381 native curve support, SEP-10/12/45 standards, and the Anchor ecosystem.

---

## System Layers

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  /register  /verify  /prove  /issuer  /admin                │
└────────────────────────┬────────────────────────────────────┘
                         │ @stellar-did/sdk (TypeScript)
┌────────────────────────▼────────────────────────────────────┐
│                   Soroban Contracts (Rust)                   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ DID Registry │  │ VC Verifier  │  │Compliance Engine │  │
│  │              │  │              │  │                  │  │
│  │ register()   │  │ add_issuer() │  │ set_policy()     │  │
│  │ resolve()    │  │ set_ring()   │  │ is_compliant()   │  │
│  │ update()     │  │ verify_cred()│  │ export_attest()  │  │
│  │ deactivate() │  │ proof_count()│  │                  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   Off-Chain Services (Node.js)               │
│                                                             │
│  ┌─────────────────────────┐  ┌──────────────────────────┐  │
│  │     KYC Issuer Service  │  │  Cross-Chain Bridge      │  │
│  │                         │  │                          │  │
│  │  POST /kyc/request      │  │  Stellar event listener  │  │
│  │  GET  /kyc/credential   │  │  EVM attestation relayer │  │
│  │  POST /issuer/approve   │  │                          │  │
│  └─────────────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Contract Interactions

### DID Registration Flow
```
User → DIDRegistry.register(address, documentHash)
     ← returns did:stellar:<address>
```

### KYC / Credential Issuance Flow
```
1. User → KYC Issuer Service: submit documents + attributes
2. Issuer reviews off-chain
3. Issuer → VCVerifier.set_attribute_ring(issuer, "kyc_passed", [pubkeys])
4. Issuer → KYC Issuer Service: store credential for user
5. User ← retrieves credential (one-time, deleted after fetch)
```

### Attribute Proof Flow (Privacy-Preserving)
```
1. User fetches ring: VCVerifier.get_ring("kyc_passed")
2. User generates ring signature client-side (BLS12-381)
   — no private key leaves the browser
3. User → VCVerifier.verify_credential("kyc_passed", challenge, signature)
4. Contract verifies ring closure, increments proof_count
5. VCVerifier → ComplianceEngine.set_compliance_status(user, "defi_pool", true)
```

### Cross-Chain Relay Flow
```
1. ComplianceEngine emits attestation event
2. Bridge service detects event via Horizon polling
3. Bridge → EVM AttestationReceiver.receiveAttestation(subject, policy, compliant, sig)
4. EVM dApps query AttestationReceiver for compliance status
```

---

## Privacy Model

- **On-chain**: only BLS public keys, attribute rings, and aggregate counters. No PII.
- **Ring signatures**: prove membership in a group without revealing which member signed. Anonymity set = ring size (default: 5).
- **Ring unlinkability**: different rings per attribute → proofs for "kyc_passed" and "over_18" cannot be correlated.
- **Off-chain**: KYC service uses ephemeral in-memory storage; credentials deleted after one-time retrieval.

---

## Standards Compliance

| Standard | Usage |
|---|---|
| W3C DID Core | DID document format, `did:stellar:` method |
| W3C VC Data Model | Verifiable Credential envelope |
| Stellar SEP-10 | Wallet authentication for service endpoints |
| Stellar SEP-12 | KYC data schema for anchor integration |
| Stellar SEP-45 | Contract account authentication |
| BLS12-381 | Ring signature scheme (native Soroban support) |

---

## Directory Structure

```
contracts/
  did_registry/       # W3C DID anchoring on Stellar
  vc_verifier/        # BLS ring signature credential verification
  compliance_engine/  # Policy-based compliance rules + cross-chain export

services/
  kyc-issuer/         # Off-chain KYC review + credential issuance
  cross-chain-bridge/ # Stellar → EVM attestation relay

sdk/
  src/
    clients/          # DIDClient, VCClient, ComplianceClient
    types.ts          # Shared TypeScript types

frontend/
  src/
    pages/            # React pages for each user role

docs/
  architecture.md     # This file
  contributing.md     # Contributor guide
  sep-references.md   # Stellar SEP standards reference
```
