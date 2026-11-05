# Stellar DID & Cross-Chain Compliance

**Status: pre-alpha prototype. Not audited, not deployed, not production ready.**

This repository contains a Soroban-based DID registry, an issuer-attested
credential/compliance layer, an off-chain KYC issuer service, a Stellar→EVM
relay service, a TypeScript SDK and a React frontend.

What works today is deliberately narrow. Read [Current capability](#current-capability)
before relying on anything here.

---

## Current capability

| Area | State |
|---|---|
| DID register / update / deactivate / resolve | **Implemented and unit-tested** (`did:stellar:<address>`) |
| Issuer-attested credentials with expiry and revocation | **Implemented and unit-tested** |
| Compliance policy evaluation (cross-contract) | **Implemented and unit-tested** |
| KYC issuer service (validate, review, one-time retrieval) | **Implemented, authenticated, unit-tested; approval submits `issue_credential` when the chain env is configured** |
| Soroban→EVM event listener (decode, validate, dedupe) | **Implemented and unit-tested** |
| EVM relayer signing + receipt verification | **Implemented; `AttestationReceiver` added and tested locally (not deployed)** |
| SDK reads (resolve, credential validity, compliance, policy) | **Implemented and unit-tested** |
| SDK writes | Builds and prepares **unsigned** transactions for the caller to sign |
| **BLS12-381 ring signatures / anonymity** | **Not implemented — disabled and fails closed** |
| **SEP-10 / SEP-12 / SEP-45** | **Not implemented** |
| **Frontend features** | **Placeholder pages only** |
| End-to-end Testnet run | **Not captured** — a deployable WASM target and the KYC contract call exist, but no transaction evidence is committed |

### About the ring-signature feature

Earlier revisions of this repository advertised client-side BLS12-381 ring
signatures and an on-chain verifier. That claim was inaccurate and the verifier
accepted **any** correctly-sized byte string. It now fails closed
(`verify_credential` always returns `false`), because:

- the pinned `soroban-sdk` 21 has **no** BLS12-381 host functions (they arrived in
  Stellar Protocol 22 / CAP-0059), and
- no ring-signature construction (domain separation, nullifier, rogue-key
  defence) was ever specified.

Re-enabling it requires a scheme specification, test vectors and independent
review. See `AUDIT.md` (C-2, C-3).

---

## How it works

1. **Register** — anchor a DID on Stellar via `DIDRegistry.register`. The
   identifier is derived from the controller address: `did:stellar:<strkey>`.
2. **Verify** — submit KYC documents to a trusted issuer off-chain
   (`POST /api/kyc/request`). The response includes a one-time retrieval token.
3. **Issue** — an authenticated issuer approves the request. When
   `SOROBAN_RPC_URL`, `NETWORK_PASSPHRASE`, `VC_VERIFIER_CONTRACT_ID` and
   `ISSUER_SECRET_KEY` are set (see `services/kyc-issuer/.env.example`), approval
   submits one `VCVerifier.issue_credential` transaction per requested attribute
   and returns the transaction hashes. Without that configuration it returns
   `503` and writes nothing on-chain. The separate local credential builder is a
   placeholder that is disabled unless explicitly enabled (it does not produce
   verifiable BLS credentials).
4. **Comply** — `ComplianceEngine.is_compliant` evaluates the policy live by
   querying the verifier for every required attribute. There is no stored
   "compliant" flag that anyone can set.
5. **Bridge** — `ComplianceEngine.export_attestation` emits an event; the bridge
   decodes it, signs an EIP-191 digest and submits it to an EVM receiver. The
   subject is a Stellar identifier carried as a string, because no Stellar
   address is a valid EVM address; the receiver must map it.

`contracts/evm` contains the destination `AttestationReceiver` (relayer
allowlist, per-subject nonce replay protection, chain-id check, EIP-191
signature verification). It is covered by Hardhat tests and a cross-language
test against the real JS relayer, but it has **not been deployed** and the relay
has not run end to end.

---

## Architecture

```
contracts/               Soroban smart contracts (Rust)
  did_registry/          DID anchoring, events, TTL retention
  vc_verifier/           Issuer-attested credentials; ring proofs disabled
  compliance_engine/     Live policy evaluation + attestation export

services/                Off-chain services (Node.js)
  kyc-issuer/            Validated KYC intake, authenticated issuer review
  cross-chain-bridge/    Soroban events → signed EVM attestation

sdk/                     TypeScript client SDK
frontend/                React dApp (placeholder pages)
docs/                    Architecture, contributing, SEP references
AUDIT.md                 Full audit: findings, evidence, remediation log
```

See [`docs/architecture.md`](docs/architecture.md) for the detailed design.

---

## Quick start

Requires Rust 1.88 (`contracts/rust-toolchain.toml`) and Node.js ≥ 20.

```bash
# Contracts: format, lint, test, and build deployable WASM
cd contracts
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo build --target wasm32v1-none --release --locked  # wasm32-unknown-unknown is rejected by the Soroban VM

# KYC issuer service
cd ../services/kyc-issuer
npm ci && npm test
cp .env.example .env    # set ISSUER_KEYS before starting
npm start

# Cross-chain bridge
cd ../services/cross-chain-bridge
npm ci && npm test

# SDK
cd ../../sdk
npm ci && npm run build && npm test && npm run lint

# Frontend
cd ../frontend
npm ci && npm run build
```

See [`docs/contributing.md`](docs/contributing.md) for setup and deployment.

---

## Security model (what you may and may not assume)

- **DID ownership** is enforced with `require_auth` on the controller. DID
  identifiers are derived from the controller key, so identifiers are *not* stable
  across key rotation (rotation is not implemented).
- **Credential authenticity** rests on an admin-registered issuer address. Issuers
  are authorised on-chain; de-registering one invalidates all of its credentials.
- **Compliance** cannot be asserted by a caller; it is derived from credentials and
  fails closed.
- **Ring-signature anonymity is not provided.** Do not describe this system as
  anonymous or as a zero-knowledge/selective-disclosure system.
- **No third-party audit** has been performed on any part of this repository.

---

## Standards

| Standard | Status |
|---|---|
| W3C DID Core | Partial — a `did:stellar:` identifier and a minimal document hash are anchored; no DID document format or resolver |
| W3C VC Data Model | **Not implemented** — credentials are contract structs, not VC envelopes |
| Stellar SEP-10 / SEP-12 / SEP-45 | **Not implemented** (see `docs/sep-references.md`) |
| BLS12-381 ring signatures | **Not implemented** |

---

## Contributing

See [`docs/contributing.md`](docs/contributing.md). `AUDIT.md` lists the open
findings and acceptance criteria; those are the highest-value places to start.

## License

MIT
