# Contributing Guide

Welcome! This project is structured so contributors can pick up well-scoped issues and make meaningful progress independently. Read `docs/architecture.md` first to understand the system.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Rust | ≥ 1.74 | Soroban contracts |
| `soroban-cli` | ≥ 21.0 | Deploy & test contracts |
| Node.js | ≥ 20 | Services & frontend |
| Freighter wallet | latest | Browser wallet for testing |

Install Soroban CLI:
```bash
cargo install --locked soroban-cli --features opt
```

---

## Project Setup

```bash
# Clone
git clone <repo-url>
cd Decentralized-Identity--DID--and-Cross-Chain-Compliance

# Build contracts
cd contracts
cargo build --target wasm32-unknown-unknown --release

# Run contract tests
cargo test

# Install service dependencies
cd ../services/kyc-issuer && npm install
cd ../cross-chain-bridge && npm install

# Install SDK dependencies
cd ../../sdk && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

---

## Running Locally

```bash
# Terminal 1 — KYC Issuer service
cd services/kyc-issuer
cp .env.example .env   # fill in SOROBAN_RPC_URL, CONTRACT_IDs
npm run dev

# Terminal 2 — Cross-chain bridge (optional)
cd services/cross-chain-bridge
cp .env.example .env
npm run dev

# Terminal 3 — Frontend
cd frontend
npm run dev
```

---

## Good First Issues

Look for issues tagged `good first issue`. Typical entry points:

- **Contracts**: implement a stubbed function (marked `// TODO`)
- **SDK**: implement a client method that calls a contract
- **Services**: add input validation, database persistence, or a new route
- **Frontend**: wire up a page to the SDK / service API
- **Tests**: add test coverage for an existing function

---

## Code Style

- **Rust**: `cargo fmt` + `cargo clippy --all-targets`
- **TypeScript/JS**: ESLint + Prettier (configs in each package)
- Keep functions small and focused. Add a `// TODO` comment for every unimplemented path.
- All public contract functions must have a doc comment explaining parameters and panics.

---

## Submitting a PR

1. Fork the repo and create a branch: `git checkout -b feat/your-feature`
2. Make your changes and add/update tests
3. Run `cargo test` (contracts) and `npm test` (services/SDK)
4. Open a PR with a clear description of what you changed and why
5. Reference the issue number in the PR description

---

## Contract Deployment (Testnet)

```bash
# Build
cargo build --target wasm32-unknown-unknown --release -p did-registry

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/did_registry.wasm \
  --source <your-secret-key> \
  --network testnet

# Initialize
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <admin-secret-key> \
  --network testnet \
  -- initialize --admin <admin-address>
```
