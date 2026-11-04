# Contributing Guide

Read `AUDIT.md` first: it lists the confirmed findings, their severity, and the
acceptance criteria for each. Those are the highest-value contributions.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Rust | 1.88 (see `contracts/rust-toolchain.toml`) | Soroban contracts |
| `rustfmt`, `clippy`, `wasm32-unknown-unknown` | matching 1.88 | Format, lint, build WASM |
| `stellar-cli` | latest (`soroban-cli` ≥ 21) | Deploy & invoke contracts |
| Node.js | ≥ 20 (CI uses 24) | Services, SDK, frontend |

```bash
rustup component add rustfmt clippy
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt
```

---

## Project setup

```bash
git clone <repo-url>
cd Decentralized-Identity--DID--and-Cross-Chain-Compliance

# Contracts
cd contracts
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo build --target wasm32-unknown-unknown --release --locked
# → target/wasm32-unknown-unknown/release/{did_registry,vc_verifier,compliance_engine}.wasm

# Services
cd ../services/kyc-issuer && npm ci
cd ../cross-chain-bridge && npm ci

# SDK
cd ../../sdk && npm ci

# Frontend
cd ../frontend && npm ci
```

The frontend depends on the local SDK via `"file:../sdk"`; build the SDK before
building the frontend (`cd sdk && npm run build`).

---

## Running locally

```bash
# Terminal 1 — KYC issuer service
cd services/kyc-issuer
cp .env.example .env          # set ISSUER_KEYS (see below)
npm start                     # http://localhost:3001

# Terminal 2 — Cross-chain bridge (requires a deployed ComplianceEngine)
cd services/cross-chain-bridge
cp .env.example .env
npm start

# Terminal 3 — Frontend
cd frontend
npm run dev                   # http://localhost:5173
```

### Issuer API keys

Issuer routes require `x-issuer-key`. The key is mapped to an issuer public key
server-side:

```bash
# Generate a key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# .env
ISSUER_KEYS=<apiKey>:<192-hex-issuer-pubkey>
```

Credential issuance is **disabled by default** because the service cannot mint
verifiable BLS credentials. `PLACEHOLDER_ISSUANCE_ENABLED=true` produces explicitly
non-verifiable placeholders for plumbing tests only.

---

## Checks before opening a PR

```bash
cd contracts && cargo fmt --all -- --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked && cargo build --target wasm32-unknown-unknown --release --locked
cd services/kyc-issuer && npm test
cd services/cross-chain-bridge && npm test
cd sdk && npm run build && npm test && npm run lint
cd frontend && npm run build
```

CI runs exactly these. A PR that leaves any of them failing will not merge.

---

## Code style

- **Rust**: `cargo fmt` and `cargo clippy --all-targets -- -D warnings` (clean).
- **TypeScript (SDK)**: ESLint (`sdk/eslint.config.mjs`).
- **JavaScript services / frontend**: no linter is configured yet (tracked in
  `AUDIT.md` M-16). Match the surrounding style.
- Document every public contract function, including its panics.
- Do not add a `TODO` for a security-relevant path and leave the unsafe behaviour
  in place. Fail closed instead.

---

## Contract deployment (Testnet)

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release --locked

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/vc_verifier.wasm \
  --source <admin-secret-key> \
  --network testnet

stellar contract invoke \
  --id <VC_VERIFIER_ID> \
  --source <admin-secret-key> \
  --network testnet \
  -- initialize --admin <admin-address>
```

**Deploy and initialise atomically.** Both `VCVerifier.initialize` and
`ComplianceEngine.initialize` take the admin as a parameter and can be front-run
if initialisation is left for a later transaction (`AUDIT.md` H-7).

Then:

1. `ComplianceEngine.set_verifier(admin, <VC_VERIFIER_ID>)`
2. `VCVerifier.add_issuer(admin, <issuer-address>)`
3. `ComplianceEngine.set_policy(admin, <policy>, [<attributes>...])`

There are **no recorded Testnet deployment addresses** for this repository. Do not
publish addresses or transaction hashes that have not actually been produced.
