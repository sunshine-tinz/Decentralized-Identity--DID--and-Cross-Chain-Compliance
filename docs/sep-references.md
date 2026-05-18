# Stellar SEP References

Quick reference for the Stellar Ecosystem Proposals (SEPs) used in this project.

## SEP-10 — Stellar Web Authentication

**Used by**: KYC Issuer service (authenticate users before accepting KYC requests)

SEP-10 defines a challenge-response authentication flow using Stellar keypairs. The server issues a challenge transaction; the client signs it with their Stellar keypair; the server verifies the signature and issues a JWT.

- Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
- SDK support: `@stellar/stellar-sdk` `WebAuth` module

**TODO**: Protect `/api/issuer/*` routes with SEP-10 JWT middleware.

---

## SEP-12 — KYC API

**Used by**: KYC Issuer service (standardised KYC data schema)

SEP-12 defines the data fields and API contract for KYC information exchange between wallets and anchors. Using this schema makes our issuer service compatible with existing Stellar wallets.

- Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0012.md
- Key fields: `first_name`, `last_name`, `email_address`, `birth_date`, `address`, `photo_id_front`

**TODO**: Align `/api/kyc/request` body schema with SEP-12 field names.

---

## SEP-45 — Stellar Web Authentication for Contract Accounts

**Used by**: Frontend (authenticate smart wallet / contract accounts)

SEP-45 extends SEP-10 to support contract accounts (C... addresses) introduced by Soroban. Required when users interact with contracts using smart wallets rather than classic keypair accounts.

- Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md
- Docs: https://developers.stellar.org/docs/platforms/anchor-platform/sep-guide/sep45

**TODO**: Add SEP-45 support to the frontend wallet connection flow.

---

## BLS12-381 on Soroban

Soroban exposes native BLS12-381 host functions via `env.crypto()`:

```rust
// Available host functions (Soroban SDK)
env.crypto().bls12_381_g1_add(p1, p2)
env.crypto().bls12_381_g1_mul(point, scalar)
env.crypto().bls12_381_g1_msm(points, scalars)
env.crypto().bls12_381_map_fp_to_g1(fp)
env.crypto().bls12_381_hash_to_g1(msg, dst)
// ... G2 equivalents
```

These are the primitives needed to implement the ring signature verification in `vc_verifier`.

Reference: https://developers.stellar.org/docs/learn/encyclopedia/security/cryptography/bls12-381
