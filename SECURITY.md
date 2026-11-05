# Security Policy

## Status

This repository is a **pre-alpha prototype**. It has not been audited by a third
party, has never been deployed, and must not be used to protect real identity
data or to move value.

See `AUDIT.md` and `ACCEPTANCE-AUDIT.md` for the current findings. Known
unimplemented areas include ring-signature proofs, SEP-10/12/45, the EVM
destination contract, and on-chain issuance from the KYC service.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting for this repository:
**Security → Advisories → Report a vulnerability**
(<https://github.com/sunshine-tinz/Decentralized-Identity--DID--and-Cross-Chain-Compliance/security/advisories/new>).

Include:

- the affected file, function, and commit;
- a reproduction (a unit test or exact commands) where possible;
- the impact you believe it has.

There is no bug-bounty programme and no guaranteed response time. Reports will
be acknowledged in the private advisory thread, and a fix will be prepared
before any public disclosure.

## Out of scope

- Missing features that are already documented as unimplemented.
- Findings that require a deployed contract, funded key, or live network access
  that the maintainers do not have.
- Denial of service through the intentionally unauthenticated public KYC intake
  endpoint beyond the documented rate limit.

## Handling secrets

Never include private keys, seed phrases, KYC documents, or real personal data
in an issue, advisory, test, or commit. The repository's `.env.example` files are
templates only.
