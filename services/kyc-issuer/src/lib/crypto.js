/**
 * Authenticated encryption at rest (AES-256-GCM) with key rotation support.
 *
 * Configuration:
 *   KYC_ENCRYPTION_KEYS="k2:<64-hex-key>,k1:<64-hex-key>"
 *   (or single-key fallback KYC_ENCRYPTION_KEY="<64-hex-key>")
 *
 * The first entry in KYC_ENCRYPTION_KEYS is the active key used for new
 * encryptions; all listed keyIds remain available for decryption so keys can
 * be rotated safely without downtime.
 */

"use strict";

const crypto = require("crypto");

const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;

/**
 * Parse encryption keys from environment. Fails closed if none configured.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ primaryId: string, keys: Map<string, Buffer> }}
 */
function loadEncryptionKeys(env = process.env) {
  const keys = new Map();
  let primaryId = null;

  if (env.KYC_ENCRYPTION_KEYS) {
    for (const part of String(env.KYC_ENCRYPTION_KEYS).split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const sep = trimmed.indexOf(":");
      if (sep <= 0) {
        throw new Error("Malformed KYC_ENCRYPTION_KEYS entry (expected keyId:64hex)");
      }
      const keyId = trimmed.slice(0, sep).trim();
      const hex = trimmed.slice(sep + 1).trim();
      if (!keyId || !KEY_HEX_RE.test(hex)) {
        throw new Error(`Invalid encryption key material for keyId "${keyId}"`);
      }
      if (!primaryId) primaryId = keyId;
      keys.set(keyId, Buffer.from(hex, "hex"));
    }
  } else if (env.KYC_ENCRYPTION_KEY) {
    const hex = String(env.KYC_ENCRYPTION_KEY).trim();
    if (!KEY_HEX_RE.test(hex)) {
      throw new Error("KYC_ENCRYPTION_KEY must be a 64-character hex string");
    }
    primaryId = "default";
    keys.set(primaryId, Buffer.from(hex, "hex"));
  }

  if (!primaryId || keys.size === 0) {
    throw new Error(
      "KYC encryption key not configured (set KYC_ENCRYPTION_KEYS or KYC_ENCRYPTION_KEY)"
    );
  }

  return { primaryId, keys };
}

function encryptText(plaintext, env = process.env) {
  const { primaryId, keys } = loadEncryptionKeys(env);
  const key = keys.get(primaryId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: "aes-256-gcm",
    keyId: primaryId,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: encrypted.toString("base64"),
  };
}

function decryptText(envelope, env = process.env) {
  if (!envelope || typeof envelope !== "object" || envelope.v !== 1) {
    throw new Error("Invalid encrypted envelope");
  }
  const { keys } = loadEncryptionKeys(env);
  const key = keys.get(envelope.keyId);
  if (!key) {
    throw new Error(`Unknown encryption keyId "${envelope.keyId}"`);
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ct, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function encryptJson(value, env = process.env) {
  return encryptText(JSON.stringify(value ?? {}), env);
}

function decryptJson(envelope, env = process.env) {
  return JSON.parse(decryptText(envelope, env));
}

function rotateEnvelope(envelope, env = process.env) {
  if (!envelope) return null;
  const { primaryId } = loadEncryptionKeys(env);
  if (envelope.keyId === primaryId) return envelope;
  const plaintext = decryptText(envelope, env);
  return encryptText(plaintext, env);
}

module.exports = {
  loadEncryptionKeys,
  encryptText,
  decryptText,
  encryptJson,
  decryptJson,
  rotateEnvelope,
};
