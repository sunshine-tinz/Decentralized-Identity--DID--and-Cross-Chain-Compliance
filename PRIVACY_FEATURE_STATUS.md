# Privacy Feature Status & Cryptographic Policy

**Document Status:** Official Cryptographic Boundary Assessment  
**Current Posture:** **STRICT FAIL-CLOSED**  
**Date:** November 5, 2026  

---

## 1. Status of Privacy & Ring Signature Features

| Privacy Feature | Implementation Status | Behavior & Guarantees |
| :--- | :--- | :--- |
| **BLS12-381 Ring Proofs** | **DISABLED / FAIL-CLOSED** | `VCVerifier::verify_credential` unconditionally returns `false`. Mutates no storage. |
| **Ring Verification Capability** | **DISABLED** | `VCVerifier::ring_verification_available` returns `false`. |
| **SDK Ring Proof Submission** | **REFUSED** | `VCClient.submitRingProof` throws an explicit error refusing to generate fake proofs. |
| **Frontend Privacy Display** | **EXPLICIT WARNING** | Dedicated banner alerts users that zero-knowledge ring proofs are unavailable. |
| **Issuer-Attested Credentials** | **FULLY FUNCTIONAL** | Public on-chain credential storage with mandatory ledger expiry and active revocation. |

---

## 2. Technical Rationale for Fail-Closed Gate

### The Insecure Prototype Legacy (AUDIT.md Finding C-2, C-3)
In the prototype repository, `VCVerifier::verify_credential` claimed to verify BLS12-381 ring signatures to allow subjects to prove credential ring membership without revealing their identity. However, examination revealed that the prototype contained no cryptographic curve logic:
```rust
// Prototype stub (vulnerable):
if signature.responses.len() == ring.public_keys.len() {
    true // Falsely accepted any arbitrary byte payload
}
```
Accepting arbitrary bytes created a catastrophic security vulnerability, allowing any attacker to forge credentials and pass compliance checks.

### Why Ring Proofs Cannot Be Re-Enabled in Pinned SDK 21
1. **Lack of Host Curve Functions**: The pinned dependency `soroban-sdk` 21.0.0 targets Stellar Protocol 20/21. Protocol 21 has no native host functions for BLS12-381 curve arithmetic (G1/G2 point addition, scalar multiplication, or pairings). While **CAP-0059** introduced these host functions in Protocol 22, the current stable SDK 21 workspace cannot invoke them.
2. **Missing Scheme Specification**: A valid, secure ring signature construction requires:
   - Linkability or nullifiers to prevent identical credentials from being presented multiple times in sybil attacks.
   - Proofs of possession for public keys to defend against rogue-key attacks.
   - A standardized hash-to-curve algorithm.
   - Formal cryptanalytic review and security proofs.

---

## 3. Clear Functional Distinctions for Users & Evaluators

The system makes an unambiguous distinction between three operational categories:

### A. Working DID & Identity Anchoring (100% Operational)
- DIDs are anchored on Stellar via `DIDRegistry.register`.
- Identifiers are deterministically derived from the controller address: `did:stellar:<strkey>`.
- Document hashes (up to 64 bytes) represent off-chain identity documents and are verified upon registration and update.

### B. Working Public On-Chain Attestation (100% Operational)
- Admin registers authorized issuers (`VCVerifier.add_issuer`).
- Issuers attest compliance attributes on-chain (`VCVerifier.issue_credential`) with explicit ledger sequence expiry.
- Issuers and admin can revoke credentials on-chain (`VCVerifier.revoke_credential`).
- De-registering an issuer automatically invalidates all credentials they previously issued.
- Compliance engine evaluates whether a subject holds all required valid credentials under a named policy.
- **Privacy Tradeoff**: These attestations are public on-chain records, visible on the Stellar ledger. They do not hide the subject's address.

### C. Planned Privacy-Preserving Proofs (Roadmap / Phase 2)
- Zero-knowledge attribute proofs (proving attributes without revealing the subject's identity).
- This capability is **NOT IMPLEMENTED** and must not be described as operational.

---

## 4. UI Transparency Audit

The frontend application has been audited to confirm that no user is ever told that their privacy or ring signature has been verified:

1. **`ProvePage.tsx` Warning Banner**:
   > **Cryptographic & Privacy Notice**: Zero-Knowledge / Ring-Signature Privacy Proofs are UNAVAILABLE. BLS12-381 ring signature verification in the contract is fail-closed (always returns false) because Protocol 21 lacks curve host functions and no formally reviewed scheme was specified.
   > The verification executed below inspects public on-chain Issuer-attested credentials with ledger sequence expiry and revocation checking. No user or attribute is marked as having zero-knowledge or cryptographic anonymity guarantees.

2. **SDK Error Handling**:
   When client applications call `VCClient.submitRingProof()`, the SDK throws:
   ```typescript
   throw new Error("Ring-signature proof verification is disabled and fails closed in this version.");
   ```

---

## 5. Upgrade Path to Production Zero-Knowledge Proofs

To introduce privacy-preserving credentials in a future version:
1. **Target Protocol 22 Host Environment**: Upgrade contracts to `soroban-sdk` supporting CAP-0059 host functions.
2. **Standard Construction**: Select an established, audited credential scheme:
   - **BBS+ Signatures** (W3C VC Data Integrity BBS Cryptosuite), or
   - **Groth16 zk-SNARKs** with a verification circuit over BLS12-381 or BN254.
3. **Formal Verification**: Engage an independent third-party cryptography audit team to review the circuits and verification contracts before mainnet deployment.
