/**
 * Credential builder.
 *
 * IMPORTANT: this does **not** produce BLS12-381 credentials. No BLS library is
 * present in this service, and the on-chain verifier cannot check ring
 * signatures (see AUDIT.md C-2/C-3). The object produced here is a *placeholder*
 * envelope with correctly shaped fields and cryptographically random key
 * material, so downstream plumbing can be exercised without pretending the
 * credential is verifiable.
 *
 * The previous implementation derived "keys" deterministically from the
 * attribute name (`Buffer.alloc(32).fill(seed.charCodeAt(0))`), which made every
 * credential for a given attribute identical and trivially guessable.
 *
 * Issuance is disabled unless PLACEHOLDER_ISSUANCE_ENABLED=true. The route layer
 * refuses to call this function otherwise.
 */

"use strict";

const crypto = require("crypto");

const RING_SIZE = 5; // 1 real user + 4 decoys
const DEFAULT_TTL_DAYS = 90;

/** Maximum credential lifetime accepted from configuration. */
const MAX_TTL_DAYS = 365;

/**
 * Generate random placeholder key material of the documented sizes
 * (32-byte private scalar, 96-byte compressed G1 public key).
 * @returns {{privateKey: string, publicKey: string}}
 */
function generatePlaceholderKeypair() {
  return {
    privateKey: crypto.randomBytes(32).toString("hex"),
    publicKey: crypto.randomBytes(96).toString("hex"),
  };
}

/**
 * Build a ring of RING_SIZE members: 1 real user + (RING_SIZE-1) decoys.
 * Decoys are random and unique per credential, so they do not form a stable
 * cross-credential fingerprint.
 * @param {string} userPubkey
 * @returns {string[]}
 */
function buildRing(userPubkey) {
  const ring = [userPubkey];
  while (ring.length < RING_SIZE) {
    const candidate = crypto.randomBytes(96).toString("hex");
    if (!ring.includes(candidate)) ring.push(candidate);
  }
  return ring;
}

/**
 * @returns {number} credential lifetime in days, clamped to [1, MAX_TTL_DAYS]
 */
function ttlDays() {
  const parsed = Number.parseInt(process.env.CREDENTIAL_TTL_DAYS || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_DAYS;
  return Math.min(parsed, MAX_TTL_DAYS);
}

/**
 * Build a placeholder credential for an approved KYC request.
 *
 * @param {object} kycReq - The approved KYC request
 * @returns {object} Placeholder credential envelope
 */
async function buildCredential(kycReq) {
  if (process.env.PLACEHOLDER_ISSUANCE_ENABLED !== "true") {
    throw new Error("Placeholder credential issuance is disabled");
  }

  const attributeKeys = {};
  const attributeRings = {};

  for (const attribute of kycReq.attributes) {
    const userKeypair = generatePlaceholderKeypair();
    attributeKeys[attribute] = userKeypair.privateKey;
    attributeRings[attribute] = buildRing(userKeypair.publicKey);
  }

  const issuedAt = Date.now();

  return {
    scheme: "placeholder-bls12-381",
    verifiable: false,
    issuerPubkey: kycReq.issuerPubkey,
    userId: kycReq.userId,
    attributeKeys,
    attributeRings,
    issuedAt,
    expiresAt: issuedAt + ttlDays() * 24 * 60 * 60 * 1000,
  };
}

module.exports = { buildCredential, generatePlaceholderKeypair, buildRing, ttlDays, RING_SIZE };
