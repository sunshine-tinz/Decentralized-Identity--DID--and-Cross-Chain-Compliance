/**
 * Ephemeral in-memory store.
 *
 * Data is intentionally NOT persisted across restarts to minimise PII retention.
 * Replace with an encrypted database for production deployments.
 *
 * TODO: add periodic cleanup of stale entries (> 24h old)
 */

"use strict";

module.exports = {
  /** Map<requestId, KYCRequest> */
  kycRequests: new Map(),

  /** Map<userId, Credential> — deleted on first read */
  issuedCredentials: new Map(),
};
