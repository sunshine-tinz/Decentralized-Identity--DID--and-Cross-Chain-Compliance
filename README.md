# Stellar DID & Cross-Chain Compliance

A privacy-preserving Decentralized Identity (DID) and cross-chain compliance system built on Stellar. Users prove KYC/AML attributes without revealing their identity, and compliance status propagates to EVM chains — no re-verification needed on every network.

## How It Works

1. **Register** — anchor a W3C DID on Stellar via the DID Registry contract
2. **Verify** — submit KYC documents to a trusted issuer off-chain
3. **Prove** — generate a BLS ring signature client-side to prove an attribute (e.g. `kyc_passed`) without revealing which ring member you are
4. **Comply** — the Compliance Engine enforces policy rules on-chain
5. **Bridge** — compliance attestations relay to EVM chains automatically

## Architecture

```
contracts/          Soroban smart contracts (Rust)
  did_registry/     W3C DID anchoring
  vc_verifier/      BLS ring signature credential verification
  compliance_engine/ Policy-based compliance + cross-chain export

services/           Off-chain services (Node.js)
  kyc-issuer/       KYC review and credential issuance
  cross-chain-bridge/ Stellar → EVM attestation relay

sdk/                TypeScript client SDK
frontend/           React dApp
docs/               Architecture, contributing guide, SEP references
```

See [`docs/architecture.md`](docs/architecture.md) for the full system design.

## Quick Start

```bash
# Build contracts
cd contracts && cargo test

# Run KYC issuer service
cd services/kyc-issuer && npm install && npm run dev

# Run frontend
cd frontend && npm install && npm run dev
```

See [`docs/contributing.md`](docs/contributing.md) for full setup instructions.

## Standards

- W3C DID Core / Verifiable Credentials Data Model
- Stellar SEP-10 (auth), SEP-12 (KYC), SEP-45 (contract account auth)
- BLS12-381 ring signatures (native Soroban support)

## Prior Art

This project draws on successful implementations in other ecosystems:
- **Polygon ID** (Ethereum) — ZK-proof based selective disclosure
- **KILT Protocol** (Polkadot) — cross-chain DID portability via DIP
- **Chainlink ACE** (multi-chain) — modular compliance engine + CCIP relay

## Contributing

See [`docs/contributing.md`](docs/contributing.md). Issues are tagged `good first issue` for new contributors.

## License

MIT
