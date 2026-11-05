/**
 * Input validation for the KYC issuer service.
 *
 * Everything that reaches storage or a contract call is validated here. Limits
 * are deliberately conservative: the service handles identity documents.
 */

"use strict";

const { StrKey } = require("@stellar/stellar-sdk");

const HEX_PUBKEY_RE = /^[0-9a-fA-F]{192}$/;
const USER_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const SYMBOL_RE = /^[a-z][a-z0-9_]{0,31}$/;

const DEFAULT_ATTRIBUTES = [
  "kyc_passed",
  "accredited_investor",
  "not_sanctioned",
  "over_18",
];

const MAX_ATTRIBUTES = 10;
const MAX_PERSONAL_INFO_BYTES = 64 * 1024;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_REASON_LENGTH = 500;

/**
 * Attributes this deployment is willing to issue. Overridable via
 * ALLOWED_ATTRIBUTES (comma separated).
 * @returns {Set<string>}
 */
function allowedAttributes() {
  const raw = process.env.ALLOWED_ATTRIBUTES;
  const list = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ATTRIBUTES;
  return new Set(list);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Validate a KYC submission.
 * @param {any} body
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
function validateKycRequest(body) {
  if (!isPlainObject(body)) return { ok: false, error: "Invalid request body" };

  const { userId, subject, issuerPubkey, attributes, personalInfo, documentPhoto } = body;

  if (typeof userId !== "string" || !USER_ID_RE.test(userId)) {
    return { ok: false, error: "Invalid userId" };
  }
  // The on-chain credential is keyed by a Stellar address, so the submission
  // must name the subject account rather than only an opaque userId.
  if (typeof subject !== "string" || !StrKey.isValidEd25519PublicKey(subject)) {
    return { ok: false, error: "Invalid subject address" };
  }
  if (typeof issuerPubkey !== "string" || !HEX_PUBKEY_RE.test(issuerPubkey)) {
    return { ok: false, error: "Invalid issuerPubkey" };
  }
  if (!Array.isArray(attributes) || attributes.length === 0) {
    return { ok: false, error: "attributes must be a non-empty array" };
  }
  if (attributes.length > MAX_ATTRIBUTES) {
    return { ok: false, error: "too many attributes" };
  }

  const allowed = allowedAttributes();
  const unique = new Set();
  for (const attribute of attributes) {
    if (typeof attribute !== "string" || !SYMBOL_RE.test(attribute)) {
      return { ok: false, error: "Invalid attribute name" };
    }
    if (!allowed.has(attribute)) {
      return { ok: false, error: `Unsupported attribute: ${attribute}` };
    }
    if (unique.has(attribute)) {
      return { ok: false, error: "Duplicate attribute" };
    }
    unique.add(attribute);
  }

  if (personalInfo !== undefined) {
    if (!isPlainObject(personalInfo)) {
      return { ok: false, error: "personalInfo must be an object" };
    }
    if (Buffer.byteLength(JSON.stringify(personalInfo)) > MAX_PERSONAL_INFO_BYTES) {
      return { ok: false, error: "personalInfo too large" };
    }
  }

  if (documentPhoto !== undefined && documentPhoto !== null) {
    if (typeof documentPhoto !== "string") {
      return { ok: false, error: "documentPhoto must be a base64 string" };
    }
    if (Buffer.byteLength(documentPhoto) > MAX_DOCUMENT_BYTES) {
      return { ok: false, error: "documentPhoto too large" };
    }
  }

  return {
    ok: true,
    value: {
      userId,
      subject,
      issuerPubkey: issuerPubkey.toLowerCase(),
      attributes: [...unique],
      personalInfo: personalInfo || {},
      documentPhoto: documentPhoto || null,
    },
  };
}

/**
 * Validate a rejection reason.
 * @param {unknown} reason
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
function validateReason(reason) {
  if (reason === undefined || reason === null) return { ok: true, value: "" };
  if (typeof reason !== "string") {
    return { ok: false, error: "reason must be a string" };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, error: "reason too long" };
  }
  return { ok: true, value: reason };
}

const RETRIEVAL_TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} token
 * @returns {boolean}
 */
function isValidRetrievalToken(token) {
  return typeof token === "string" && RETRIEVAL_TOKEN_RE.test(token);
}

module.exports = {
  validateKycRequest,
  validateReason,
  isValidRetrievalToken,
  allowedAttributes,
  HEX_PUBKEY_RE,
  USER_ID_RE,
};
