/**
 * Issuer authentication.
 *
 * Configuration:
 *   ISSUER_KEYS="<apiKey>:<issuerId>,<apiKey2>:<issuerId2>"
 *   where <issuerId> is either a Stellar StrKey public address (G...) or a
 *   legacy 192-hex BLS public key.
 */

"use strict";

const crypto = require("crypto");
const { StrKey } = require("@stellar/stellar-sdk");

const HEX_PUBKEY_RE = /^[0-9a-f]{192}$/;

function timingSafeEqualStrings(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isValidIssuerId(value) {
  if (typeof value !== "string") return false;
  return StrKey.isValidEd25519PublicKey(value) || HEX_PUBKEY_RE.test(value.toLowerCase());
}

/**
 * Parse ISSUER_KEYS into a Map<apiKey, issuerId>.
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
    const rawId = entry.slice(separator + 1).trim();
    const issuerId = StrKey.isValidEd25519PublicKey(rawId) ? rawId : rawId.toLowerCase();
    if (!apiKey || !isValidIssuerId(issuerId)) continue;

    registry.set(apiKey, issuerId);
  }

  return registry;
}

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

module.exports = { requireIssuer, parseIssuerKeys, timingSafeEqualStrings, isValidIssuerId };
