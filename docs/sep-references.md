# Stellar SEP References

Reference notes for the Stellar Ecosystem Proposals (SEPs) this project *intends*
to support.

> **Status: none of these SEPs are implemented.** No SEP-10 middleware, SEP-12
> schema, or SEP-45 flow exists in this repository. The README lists them as
> future work, not as capabilities.

## SEP-10 — Stellar Web Authentication

**Intended use**: authenticate users and issuers against the KYC issuer service.

SEP-10 defines a challenge-response flow using Stellar keypairs: the server issues
a challenge transaction, the client signs it, and the server verifies the
signature and issues a JWT.

- Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
- SDK support: `@stellar/stellar-sdk` `WebAuth` module

**Current state**: issuer routes require a static API key (`x-issuer-key`), not
SEP-10. The user-facing submission endpoint is unauthenticated by design and
rate-limited.

---

## SEP-12 — KYC API

**Intended use**: standardise the KYC data schema so wallets and anchors can
interoperate.

- Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0012.md
- Key fields: `first_name`, `last_name`, `email_address`, `birth_date`, `address`,
  `photo_id_front`

**Current state**: the request body is `{ userId, issuerPubkey, attributes,
personalInfo, documentPhoto }`. `personalInfo` is free-form and is **not**
SEP-12 aligned.

---

## SEP-45 — Web Authentication for Contract Accounts

**Intended use**: authenticate smart-wallet (contract) accounts.

- Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md

**Current state**: not implemented; the frontend has no wallet connection at all.

---

## BLS12-381 on Soroban

BLS12-381 host functions were introduced by **Stellar Protocol 22** (CAP-0059),
exposed in `soroban-sdk` **22.0.0 and later**:

```rust
env.crypto().bls12_381_g1_add(p1, p2)
env.crypto().bls12_381_g1_mul(point, scalar)
env.crypto().bls12_381_g1_msm(points, scalars)
env.crypto().bls12_381_map_fp_to_g1(fp)
env.crypto().bls12_381_hash_to_g1(msg, dst)
```

**This project pins `soroban-sdk` 21.x, which has none of these functions.** The
`env.crypto()` surface in 21.x is limited to `sha256`, `keccak256`,
`ed25519_verify`, `secp256k1_recover`, and `secp256r1_verify`.

Consequently the on-chain ring-signature verifier is disabled and fails closed.
Upgrading the SDK is necessary but **not sufficient**: a specific ring-signature
construction (with domain separation, a nullifier, and rogue-key defence) must be
chosen, implemented, tested against vectors, and independently reviewed before any
anonymity claim is made.

Reference: https://developers.stellar.org/docs/learn/encyclopedia/security/cryptography/bls12-381
