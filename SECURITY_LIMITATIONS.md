# Security, Cryptographic Assumptions & System Limitations

**Document Version:** 1.0.0  
**Scope:** Core Soroban Smart Contracts, Cryptographic Primitives, Cross-Chain Bridge, and EVM Receiver  
**Date:** November 5, 2026  

---

## 1. Cryptographic Privacy & Ring Signature Analysis

### Historical Vulnerability (AUDIT.md Finding C-2, C-3)
In the prototype repository, the `VCVerifier::verify_credential` method claimed to verify BLS12-381 ring signatures to allow subjects to prove membership in a credential ring without revealing their identity. However, inspection revealed that the contract performed no cryptographic curve operations:
```rust
// Insecure prototype logic:
if signature.responses.len() == ring.public_keys.len() {
    true // Accepted any arbitrary bytes!
}
```
This turned all downstream compliance checks into a rubber stamp, allowing any caller to forge membership in any compliance ring.

### Remediation & Fail-Closed Security Posture
Rather than implementing an improvised, unreviewed cryptographic scheme or retaining a mock, the system enforces a strict **fail-closed security gate**:
1. `VCVerifier::verify_credential` **always returns `false`** and mutates no state.
2. `VCVerifier::ring_verification_available` explicitly returns `false`.
3. The TypeScript SDK refuses to submit fake ring proofs, throwing an explicit error.
4. The React frontend displays a persistent, prominent warning banner informing users that zero-knowledge/ring-signature privacy proofs are **UNAVAILABLE**.
5. No user or attribute is marked as having zero-knowledge privacy guarantees.

### Root Technical Constraints
1. **Host Function Support**: The workspace pins `soroban-sdk` 21.0.0, which targets Protocol 20/21. Native BLS12-381 curve arithmetic host functions were introduced in Stellar Protocol 22 under **CAP-0059**.
2. **Missing Scheme Specification**: A production ring-signature or zero-knowledge credential system requires:
   - Cryptographic domain separation.
   - Linkable ring signatures with nullifiers (image keys) to detect and prevent double-spending or sybil proofs.
   - Rogue-key attack protection (e.g., proofs of possession for registered public keys).
   - Standardized point serialization and curve generators.

### Production Roadmap for Privacy Proofs
To re-enable privacy-preserving proofs in a future major release:
1. Upgrade to a Soroban SDK release supporting Protocol 22 CAP-0059 host functions.
2. Implement a formally specified construction, such as:
   - **BBS+ Signatures** (W3C VC Data Integrity BBS Cryptosuite v1.0), or
   - **Groth16 / Plonk zk-SNARKs** with verification over BLS12-381 or BN254.
3. Complete independent cryptanalytic review and formal verification.

---

## 2. On-Chain Identity & Credential Security Model

In place of unverified privacy proofs, the production-ready path operates on **Issuer-Attested Verifiable Credentials**:
- **Issuer Governance**: Issuers must be explicitly registered by the contract administrator (`add_issuer`).
- **Immediate Invalidation on De-registration**: If an issuer key is revoked (`remove_issuer`), all credentials ever issued by that issuer immediately fail verification (`is_credential_valid` checks live issuer registration).
- **Mandatory Expiry**: All credentials must be issued with an explicit future ledger sequence (`expires_at > now`). Stale credentials automatically fail closed upon expiration.
- **Revocation Tracking**: Registered issuers and the admin can revoke individual credentials on-chain (`revoke_credential`), which prevents replay or reuse.

### Key Lifecycle & DID Limitations
- **Controller-Bound Identifiers**: DIDs are derived deterministically from the Ed25519 controller public key: `did:stellar:<strkey>`.
- **Key Rotation**: The contract does not currently support key rotation without changing the DID identifier. If a user rotates their underlying Stellar keypair, a new DID must be registered.

---

## 3. Cross-Chain Bridge & EVM Receiver Security

### Threat Model & Protections
The cross-chain bridge connects Stellar compliance attestations to EVM destinations (`AttestationReceiver.sol`).

| Threat Vector | Mitigation Mechanism |
| :--- | :--- |
| **Attestation Replay** | The destination contract tracks a `consumedNonce` mapping. Once a nonce is used, subsequent submissions revert with `NonceAlreadyConsumed`. |
| **Cross-Chain Replay** | The signed digest binds `block.chainid`. Submitting a signature generated for Sepolia to Ethereum Mainnet reverts with `UnauthorizedRelayer`. |
| **Cross-Contract Replay** | The signed digest binds `address(this)`. Submitting a signature intended for Receiver A to Receiver B reverts with `UnauthorizedRelayer`. |
| **Payload Tampering** | The digest includes `(subject, policy, compliant, nonce, chainId, targetContract)`. Any altered field breaks signature recovery. |
| **Unauthorized Relayers** | The contract enforces an `authorizedRelayers` mapping managed exclusively by the contract owner. Signatures from unapproved keys revert with `UnauthorizedRelayer`. |

### Relayer Centralization Assumption
- **Current Architecture**: A single authorized relayer signs EIP-191 personal signatures and submits transactions.
- **Trust Assumption**: The security of destination chains assumes that the private key of the authorized relayer is kept secure in an HSM or KMS.
- **Production Roadmap**: For high-value Mainnet deployment, replace the single-relayer signing scheme with an on-chain threshold signature validator committee (e.g. 3-of-5 multisig) or a zero-knowledge state-proof light client.

---

## 4. Operational & Infrastructure Security

1. **Storage TTL Management**: All persistent and instance storage entries in the Soroban smart contracts extend their time-to-live (`extend_ttl(4096, 17280)`) on every state change, preventing contract data from becoming archived during inactive periods.
2. **Rate Limiting & Anti-DDoS**: The off-chain KYC Issuer service incorporates windowed IP rate limiting to protect document submission and review endpoints from denial-of-service and credential stuffing attacks.
3. **Fail-Closed Default**: In all contracts and services, unrecognized inputs, unconfigured relayers, expired sessions, and missing configurations fail closed.
