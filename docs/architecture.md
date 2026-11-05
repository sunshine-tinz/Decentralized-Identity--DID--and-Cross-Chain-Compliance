# Architecture

## Overview

The system anchors `did:stellar:` identifiers on Soroban, records issuer-attested
compliance attributes with expiry and revocation, evaluates compliance policies
on-chain, and exports attestation snapshots that a relayer can forward to an EVM
chain.

It is a prototype. Ring-signature proofs and standards conformance are **not**
implemented; see `AUDIT.md` for the full findings.

## Layer diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    Frontend (React, Vite)                    │
│  /register  /verify  /prove  /issuer  /admin                 │
│  Placeholder pages — no SDK or API calls wired yet.          │
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
│  └──────────────────────────┘  └───────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
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

Step 3 is implemented in `services/kyc-issuer/src/lib/chain.js`. When the chain
environment is configured, approval submits one `issue_credential` transaction
per attribute, waits for the RPC to report `SUCCESS`, and stores the returned
transaction hashes. If the chain environment is absent the route returns `503`
and writes nothing; if the submission fails it returns `502`. A separate local
placeholder envelope remains available and is disabled by default.

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
4. Bridge signs EIP-191(keccak256(subject, policy, compliant, ledger, nonce, chainId))
5. Bridge → EVM AttestationReceiver.receiveAttestation(subject, policy, compliant, nonce, sig)
```

`subject` is a Stellar strkey and is carried as a string: no Stellar address is a
valid EVM address. The destination contract must map it to a trusted EVM account
or allowlist entry. Events from reverted contract calls
(`inSuccessfulContractCall: false`) are dropped, and the persisted cursor is the
RPC paging token, not the event id. The bridge verifies `receipt.status == 1`
before treating a relay as successful.

Step 5's destination contract is `contracts/evm/contracts/AttestationReceiver.sol`:
it allowlists relayers, rejects replayed `(subject, nonce)` pairs, binds every
signature to the receiver address and chain id, and rejects stale ledgers. It is
tested locally (Hardhat plus a cross-language test using the real JS relayer) but
**not deployed**, and no finality policy exists beyond the RPC confirming the
source event. The attestation payload is a snapshot, not an on-chain signature:
only the relayer's signature can be verified, which makes the relayer a trusted
party.

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
| W3C VC Data Model | Not implemented |
| SEP-10 / SEP-12 / SEP-45 | Not implemented (see `sep-references.md`) |
| BLS12-381 | Not available in the pinned SDK (Protocol 22+ required); no scheme implemented |

## Storage and retention

| Contract | Key | Durability |
|---|---|---|
| DID Registry | `DID:<address>` | persistent, TTL bumped on write/resolve |
| VC Verifier | `RING:<attribute>` | persistent, TTL bumped on write |
| VC Verifier | `CRED:<subject>:<attribute>` | persistent, TTL bumped on write |
| Compliance | `POL:<name>` | persistent, TTL bumped on write |
| VC Verifier / Compliance | `ADMIN`, `ISSUERS`, `VERIFIER` | instance, TTL bumped on write |

TTL constants are ~30 days (threshold 129,600; extend to 518,400 ledgers at
5 s/ledger) for DID, credential, policy and instance entries. Simulation-based
reads do not persist a TTL bump, so an entry that is only ever read can still
archive; it must be restored before it can be read again. The previous 17,280
ledger (~24 h) window archived live identity data.

## Known limitations

See `AUDIT.md`. The principal ones:

1. Ring proofs disabled; no anonymity.
2. EVM destination contract exists but is undeployed; relay untested end to end.
3. KYC service is in-memory and unencrypted; on-chain issuance is wired but has no
   committed Testnet transaction evidence, and the placeholder envelope is not a
   verifiable credential.
4. DID identifiers are bound to the controller key (no rotation/recovery).
5. Initialisation is not atomic with deployment (front-running risk on deploy).
6. Frontend pages are placeholders.
