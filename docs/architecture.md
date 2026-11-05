# Architecture

## Overview

The system anchors `did:stellar:` identifiers on Soroban, records issuer-attested
compliance attributes with expiry and revocation, evaluates compliance policies
on-chain, and exports attestation snapshots that a relayer can forward to an EVM
chain.

It is a functional prototype. Ring-signature proofs and zero-knowledge selective
disclosure are **not** implemented; public on-chain verifiable credentials are used
instead. See `AUDIT.md` and `PRIVACY_FEATURE_STATUS.md` for the full findings.

## Layer diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    Frontend (React, Vite)                    │
│  /register  /verify  /prove  /compliance  /bridge  /issuer   │
│  Freighter wallet context, live contract RPC & KYC API calls │
└─────────────────────────┬────────────────────────────────────┘
                          │ @stellar-did/sdk (TypeScript)
┌─────────────────────────▼────────────────────────────────────┐
│                   Soroban Contracts (Rust)                    │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │  DID Registry   │  │  VC Verifier   │  │  Compliance    │ │
│  │                 │  │                │  │  Engine       │ │
│  │ register()      │  │ initialize()   │  │ initialize()  │ │
│  │ update()        │  │ add_issuer()   │  │ set_verifier()│ │
│  │ deactivate()    │  │ issue_cred()   │  │ set_policy()  │ │
│  │ resolve()       │  │ revoke_cred()  │  │ is_compliant()│ │
│  │                 │  │ is_cred_valid()│  │ export_attest()│ │
│  └────────────────┘  └───────▲────────┘  └───────┬────────┘ │
│                              │ cross-contract    │          │
│                              └───────────────────┘          │
└─────────────────────────┬────────────────────────────────────┘
                          │ Soroban RPC events
┌─────────────────────────▼────────────────────────────────────┐
│                   Off-Chain Services (Node.js)                │
│  ┌──────────────────────────┐  ┌───────────────────────────┐ │
│  │     KYC Issuer Service    │  │     Cross-Chain Bridge    │ │
│  │ POST /api/kyc/request     │  │ Soroban getEvents         │ │
│  │ GET  /api/kyc/credential  │  │ validate + dedupe          │ │
│  │ POST /api/issuer/approve  │  │ sign + relay to EVM        │ │
│  └──────────────────────────┘  └─────────────┬─────────────┘ │
└──────────────────────────────────────────────┼───────────────┘
                                               │ EIP-191 relayer tx
                                  ┌────────────▼─────────────┐
                                  │   EVM Destination        │
                                  │ AttestationReceiver.sol  │
                                  │ Replay + domain check    │
                                  └──────────────────────────┘
```

## Contract interactions

### DID registration

```
User → DIDRegistry.register(controller, documentHash)
     ← "did:stellar:<strkey>"
```

- Requires the controller's authorisation.
- Emits `(did, register)` with the controller and identifier.
- Persistent entries are TTL-extended on write and on resolve.

### Credential issuance (issuer-attested)

```
1. User    → KYC Issuer Service: POST /api/kyc/request
             ← { requestId, retrievalToken }
2. Issuer  → POST /api/issuer/approve  (x-issuer-key)
3. Issuer  → VCVerifier.issue_credential(issuer, subject, attribute, expiresAt)
4. User    → GET /api/kyc/credential/<retrievalToken>   (single use)
```

The issuer must be an admin-registered **address**; the contract checks
membership before writing. Credentials carry `expires_at` and a `revoked` flag.

### Compliance evaluation

```
ComplianceEngine.is_compliant(subject, policy)
  → for each attribute in policy.required_attributes:
      VCVerifier.is_credential_valid(subject, attribute)
  → true only if every attribute is valid
```

Compliance is **computed**, never stored. An unknown policy, an unset verifier, or
any missing/expired/revoked credential yields `false`.

### Ring-signature attribute proofs (disabled)

The original design:

```
1. User fetches ring: VCVerifier.get_ring("kyc_passed")
2. User generates a ring signature client-side
3. User → VCVerifier.verify_credential(...)
4. Contract verifies ring closure and records the proof
```

This is **not implemented**. `verify_credential` always returns `false` and does
not mutate state, because the pinned SDK has no BLS12-381 host functions and no
scheme was specified. Any future implementation needs domain separation
(contract id, network, attribute, subject, nonce, ledger), a nullifier for replay
protection, and protection against rogue keys.

### Cross-chain relay

```
1. ComplianceEngine.export_attestation(subject, policy)
     emits (compliance, attestation) = (subject, policy, compliant)
2. Bridge reads Soroban RPC getEvents, filtering by contract + topics
3. Bridge validates contract id, topics, address, policy, and boolean
4. Bridge signs EIP-191(keccak256(subject, policy, compliant, nonce, chainId, destinationAddress))
5. Bridge → EVM AttestationReceiver.receiveAttestation(subject, policy, compliant, nonce, sig)
6. Bridge verifies receipt.status == 1
```

The EVM receiver contract is implemented in `contracts/evm/AttestationReceiver.sol`.
It enforces owner governance, relayer allowlisting, single-use nonce tracking, and
strict domain separation via `address(this)` and `block.chainid`.
Automated testing in `services/cross-chain-bridge/__tests__/receiver.test.js` verifies
8 security properties against attacks (forgery, replay, chain mismatch, contract mismatch,
tampering). Live broadcast to a public EVM testnet (e.g. Sepolia) requires a configured
RPC URL and funded relayer private key.

## Privacy model

- **On-chain**: addresses, attribute symbols, credential timestamps and flags, and
  policy definitions. No PII.
- **Off-chain**: the KYC service holds personal data and documents in process
  memory. There is no encryption at rest, no retention job, and no database.
- **Anonymity: none.** Ring decoys in the placeholder credential builder are random
  filler, not cryptographic ring members. Do not make anonymity or
  unlinkability claims about this code.
- Credential retrieval uses a single-use token; it is not keyed on a user-supplied
  identifier.

## Standards

| Standard | Status |
|---|---|
| W3C DID Core | Partial — identifier + document hash only; no DID document or resolver |
| W3C VC Data Model | Not implemented — typed contract structs used |
| EIP-191 | Fully implemented on EVM `AttestationReceiver.sol` |
| SEP-10 / SEP-12 / SEP-45 | Not implemented (deferred to Phase 2 roadmap) |
| BLS12-381 | Not available in the pinned SDK (Protocol 22+ required); no scheme implemented |

## Storage and retention

| Contract | Key | Durability |
|---|---|---|
| DID Registry | `DID:<address>` | persistent, TTL bumped on write/resolve |
| VC Verifier | `RING:<attribute>` | persistent, TTL bumped on write |
| VC Verifier | `CRED:<subject>:<attribute>` | persistent, TTL bumped on write |
| Compliance | `POL:<name>` | persistent, TTL bumped on write |
| VC Verifier / Compliance | `ADMIN`, `ISSUERS`, `VERIFIER` | instance, TTL bumped on write |

## Known limitations

See `AUDIT.md` and `SECURITY_LIMITATIONS.md`. The principal ones:

1. **Ring proofs disabled; no anonymity**: public on-chain credentials used.
2. **Live public EVM broadcasting pending deployment infrastructure**: receiver and relayer verified via automated EVM test suites; live Sepolia execution requires funded gas keys.
3. **KYC service is in-memory and unencrypted**: documents are stored in memory for review.
4. **DID identifiers are bound to controller keys**: rotation and recovery are not supported.
5. **Phase 2 roadmap**: SEP-10 / SEP-12 auth flows and CAP-0059 zero-knowledge proof circuits.
