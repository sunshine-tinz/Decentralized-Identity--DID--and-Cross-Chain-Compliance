/**
 * Ephemeral in-memory encrypted store with explicit PII retention & purging.
 *
 * Security controls:
 *  - Sensitive PII (`personalInfo`, `documentPhoto`) is encrypted at rest with
 *    AES-256-GCM before storage (never stored as plaintext).
 *  - Credentials are keyed by a short-lived, single-use retrieval token and
 *    bound to the authenticated subject's Stellar address.
 *  - Automatic retention sweeping scrubs expired PII and removes expired
 *    retrieval tokens.
 */

"use strict";

const { encryptJson, encryptText, decryptJson, decryptText, rotateEnvelope } = require("./lib/crypto");

const DEFAULT_PII_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_RETRIEVAL_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Map<requestId, KYCRequestRecord> */
const kycRequests = new Map();

/** Map<retrievalToken, IssuedCredentialEntry> */
const issuedCredentials = new Map();

function getRetentionMs(env = process.env) {
  const parsed = Number(env.PII_RETENTION_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PII_RETENTION_MS;
}

function getRetrievalTtlMs(env = process.env) {
  const parsed = Number(env.RETRIEVAL_TOKEN_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETRIEVAL_TOKEN_TTL_MS;
}

function saveKycRequest(record, env = process.env) {
  const now = record.createdAt || Date.now();
  const encryptedPersonalInfo = encryptJson(record.personalInfo || {}, env);
  const encryptedDocumentPhoto = record.documentPhoto
    ? encryptText(record.documentPhoto, env)
    : null;

  const stored = {
    requestId: record.requestId,
    userId: record.userId,
    subject: record.subject,
    issuerPubkey: record.issuerPubkey,
    attributes: [...record.attributes],
    encryptedPersonalInfo,
    encryptedDocumentPhoto,
    hasDocument: Boolean(record.documentPhoto),
    retrievalToken: record.retrievalToken,
    status: record.status || "pending",
    createdAt: now,
    piiExpiresAt: now + getRetentionMs(env),
    piiPurged: false,
    issuedAttributes: [],
  };

  kycRequests.set(record.requestId, stored);
  return stored;
}

function decryptRequestPii(requestRecord, env = process.env) {
  if (!requestRecord || requestRecord.piiPurged) {
    return null;
  }
  return {
    personalInfo: requestRecord.encryptedPersonalInfo
      ? decryptJson(requestRecord.encryptedPersonalInfo, env)
      : null,
    documentPhoto: requestRecord.encryptedDocumentPhoto
      ? decryptText(requestRecord.encryptedDocumentPhoto, env)
      : null,
  };
}

function scrubRequestPii(requestId) {
  const record = kycRequests.get(requestId);
  if (!record) return false;
  record.encryptedPersonalInfo = null;
  record.encryptedDocumentPhoto = null;
  record.piiPurged = true;
  record.piiPurgedAt = Date.now();
  return true;
}

function deleteKycRequest(requestId) {
  const record = kycRequests.get(requestId);
  if (!record) return false;
  if (record.retrievalToken) {
    issuedCredentials.delete(record.retrievalToken);
  }
  scrubRequestPii(requestId);
  kycRequests.delete(requestId);
  return true;
}

function saveIssuedCredential(token, { requestId, subject, credential }, env = process.env) {
  const now = Date.now();
  const entry = {
    requestId,
    subject,
    encryptedCredential: encryptJson(credential, env),
    createdAt: now,
    expiresAt: now + getRetrievalTtlMs(env),
  };
  issuedCredentials.set(token, entry);
  return entry;
}

function takeIssuedCredential(token, env = process.env, now = Date.now()) {
  const entry = issuedCredentials.get(token);
  if (!entry) return null;
  if (now > entry.expiresAt) {
    issuedCredentials.delete(token);
    return { expired: true, subject: entry.subject, requestId: entry.requestId };
  }
  const credential = decryptJson(entry.encryptedCredential, env);
  return { expired: false, subject: entry.subject, requestId: entry.requestId, credential };
}

function consumeIssuedCredential(token) {
  return issuedCredentials.delete(token);
}

function purgeExpired(now = Date.now()) {
  let scrubbedCount = 0;
  let deletedTokens = 0;

  for (const [id, req] of kycRequests) {
    if (!req.piiPurged && now >= req.piiExpiresAt) {
      scrubRequestPii(id);
      scrubbedCount += 1;
    }
    if (req.piiPurged && now >= req.piiExpiresAt + getRetentionMs()) {
      kycRequests.delete(id);
    }
  }

  for (const [token, entry] of issuedCredentials) {
    if (now > entry.expiresAt) {
      issuedCredentials.delete(token);
      deletedTokens += 1;
    }
  }

  return { scrubbedCount, deletedTokens };
}

function rotateAllEncryptionKeys(env = process.env) {
  let rotated = 0;
  for (const req of kycRequests.values()) {
    if (req.piiPurged) continue;
    if (req.encryptedPersonalInfo) {
      req.encryptedPersonalInfo = rotateEnvelope(req.encryptedPersonalInfo, env);
    }
    if (req.encryptedDocumentPhoto) {
      req.encryptedDocumentPhoto = rotateEnvelope(req.encryptedDocumentPhoto, env);
    }
    rotated += 1;
  }
  for (const entry of issuedCredentials.values()) {
    if (entry.encryptedCredential) {
      entry.encryptedCredential = rotateEnvelope(entry.encryptedCredential, env);
    }
  }
  return rotated;
}

module.exports = {
  kycRequests,
  issuedCredentials,
  saveKycRequest,
  decryptRequestPii,
  scrubRequestPii,
  deleteKycRequest,
  saveIssuedCredential,
  takeIssuedCredential,
  consumeIssuedCredential,
  purgeExpired,
  rotateAllEncryptionKeys,
};
