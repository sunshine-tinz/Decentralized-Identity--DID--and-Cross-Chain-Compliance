/**
 * Issuer authentication.
 *
 * Issuers authenticate with a high-entropy API key supplied out of band. The key
 * is mapped to the issuer's public key by configuration, so the caller can never
 * choose which issuer they are.
 *
 * Configuration:
 *   ISSUER_KEYS="<apiKey>:<192-hex-pubkey>,<apiKey2>:<pubkey2>"
 *
 * The registry is read per request so keys can be rotated without a restart and
 * so tests can configure it per case.
 */

"use strict";

const crypto = require("crypto");

const PUBKEY_RE = /^[0-9a-f]{192}$/;

/**
 * Constant-time string comparison that does not leak length.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualStrings(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Parse ISSUER_KEYS into a Map<apiKey, issuerPubkey>.
 * Malformed entries are skipped rather than trusted.
 * @param {string} [raw]
 * @returns {Map<string, string>}
 */
function parseIssuerKeys(raw) {
  const registry = new Map();
  if (!raw) return registry;

  for (const pair of String(raw).split(",")) {
    const entry = pair.trim();
    if (!entry) continue;

    const separator = entry.indexOf(":");
    if (separator <= 0) continue;

    const apiKey = entry.slice(0, separator).trim();
    const pubkey = entry.slice(separator + 1).trim().toLowerCase();
    if (!apiKey || !PUBKEY_RE.test(pubkey)) continue;

    registry.set(apiKey, pubkey);
  }

  return registry;
}

/**
 * Express middleware: require a valid issuer API key.
 * On success sets `req.issuer = { pubkey }`.
 */
function requireIssuer(req, res, next) {
  const provided = req.get("x-issuer-key");
  if (!provided) return res.status(401).json({ error: "Unauthorized" });

  const registry = parseIssuerKeys(process.env.ISSUER_KEYS);
  for (const [apiKey, pubkey] of registry) {
    if (timingSafeEqualStrings(apiKey, provided)) {
      req.issuer = { pubkey };
      return next();
    }
  }

  return res.status(401).json({ error: "Unauthorized" });
}

module.exports = { requireIssuer, parseIssuerKeys, timingSafeEqualStrings };
