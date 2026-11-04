/**
 * Ephemeral in-memory store.
 *
 * Data is intentionally NOT persisted across restarts to minimise PII retention.
 * Replace with an encrypted database for production deployments.
 *
 * Credentials are keyed by the one-time retrieval token issued at submission
 * time, never by a user-supplied identifier — keying on `userId` allowed anyone
 * who knew (or chose) a userId to fetch or destroy another person's credential.
 *
 * Known gaps (AUDIT.md):
 *  - Plaintext at rest (process memory)
 *  - No retention/cleanup job for stale requests
 */

"use strict";

module.exports = {
  /** Map<requestId, KYCRequest> */
  kycRequests: new Map(),

  /** Map<retrievalToken, Credential> — deleted on first read */
  issuedCredentials: new Map(),
};
