/**
 * SEP-10 Stellar Web Authentication and Session JWT Enforcement
 *
 * Flow:
 *  1. GET /api/auth/challenge?account=G... -> returns SEP-10 challenge XDR
 *  2. Client signs challenge XDR with their Stellar keypair / Freighter
 *  3. POST /api/auth/token { transaction } -> verifies challenge signatures +
 *     timebounds + anti-replay, returns short-lived HMAC-SHA256 bearer JWT
 *  4. Protected user endpoints require `Authorization: Bearer <token>` and bind
 *     `req.user.account` to the authenticated Stellar public key.
 */

"use strict";

const crypto = require("crypto");
const { Keypair, Networks, StrKey, WebAuth } = require("@stellar/stellar-sdk");

const DEFAULT_HOME_DOMAIN = "kyc-issuer.stellar-did.local";
const DEFAULT_CHALLENGE_TIMEOUT_SEC = 300;
const DEFAULT_JWT_TTL_SEC = 900;

/** Track consumed SEP-10 challenge hashes to prevent replay within timebounds. */
const consumedChallenges = new Map();

function loadSep10Config(env = process.env) {
  const secret = env.SEP10_SIGNING_KEY;
  if (!secret) {
    throw new Error("SEP10_SIGNING_KEY is not configured");
  }
  const serverKeypair = Keypair.fromSecret(secret.trim());
  const networkPassphrase = env.NETWORK_PASSPHRASE || Networks.TESTNET;
  const homeDomain = env.SEP10_HOME_DOMAIN || DEFAULT_HOME_DOMAIN;
  const webAuthDomain = env.SEP10_WEB_AUTH_DOMAIN || homeDomain;
  const jwtSecret =
    env.SEP10_JWT_SECRET ||
    crypto.createHash("sha256").update(`sep10-jwt:${serverKeypair.secret()}`).digest("hex");

  return {
    serverKeypair,
    networkPassphrase,
    homeDomain,
    webAuthDomain,
    jwtSecret,
    challengeTimeoutSec: Number(env.SEP10_CHALLENGE_TIMEOUT_SEC || DEFAULT_CHALLENGE_TIMEOUT_SEC),
    jwtTtlSec: Number(env.SEP10_JWT_TTL_SEC || DEFAULT_JWT_TTL_SEC),
  };
}

function createChallenge(account, env = process.env) {
  if (typeof account !== "string" || !StrKey.isValidEd25519PublicKey(account)) {
    throw new Error("Invalid Stellar account address");
  }
  const cfg = loadSep10Config(env);
  const transaction = WebAuth.buildChallengeTx(
    cfg.serverKeypair,
    account,
    cfg.homeDomain,
    cfg.challengeTimeoutSec,
    cfg.networkPassphrase,
    cfg.webAuthDomain
  );
  return {
    transaction,
    network_passphrase: cfg.networkPassphrase,
  };
}

function purgeConsumedChallenges(now = Date.now()) {
  for (const [hash, exp] of consumedChallenges) {
    if (now > exp) consumedChallenges.delete(hash);
  }
}

function verifyChallengeAndIssueToken(txXdr, env = process.env) {
  if (typeof txXdr !== "string" || !txXdr.trim()) {
    throw new Error("Signed challenge transaction XDR is required");
  }

  const cfg = loadSep10Config(env);
  const { tx, clientAccountID } = WebAuth.readChallengeTx(
    txXdr.trim(),
    cfg.serverKeypair.publicKey(),
    cfg.networkPassphrase,
    cfg.homeDomain,
    cfg.webAuthDomain
  );

  // Enforce single-use challenge replay protection.
  purgeConsumedChallenges();
  const txHash = tx.hash().toString("hex");
  if (consumedChallenges.has(txHash)) {
    throw new Error("Challenge transaction has already been used");
  }

  // Verify both server and client signatures via SEP-10 verifier.
  const signersFound = WebAuth.verifyChallengeTxSigners(
    txXdr.trim(),
    cfg.serverKeypair.publicKey(),
    cfg.networkPassphrase,
    [clientAccountID],
    cfg.homeDomain,
    cfg.webAuthDomain
  );

  if (!signersFound || !signersFound.includes(clientAccountID)) {
    throw new Error("Challenge transaction is missing client signature");
  }

  const maxTimeMs = Number(tx.timeBounds?.maxTime || 0) * 1000 || Date.now() + 300_000;
  consumedChallenges.set(txHash, maxTimeMs);

  const token = signSessionJwt(clientAccountID, cfg);
  return { token, account: clientAccountID, expiresIn: cfg.jwtTtlSec };
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

function signSessionJwt(account, cfg) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: account,
      iat: nowSec,
      exp: nowSec + cfg.jwtTtlSec,
      jti: crypto.randomUUID(),
    })
  );
  const sig = crypto
    .createHmac("sha256", cfg.jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function verifySessionJwt(token, env = process.env) {
  if (typeof token !== "string") throw new Error("Missing token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [headerB64, payloadB64, sigB64] = parts;

  const cfg = loadSep10Config(env);
  const expectedSig = crypto
    .createHmac("sha256", cfg.jwtSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");

  const a = Buffer.from(sigB64);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload || typeof payload.sub !== "string" || !StrKey.isValidEd25519PublicKey(payload.sub)) {
    throw new Error("Invalid token subject");
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
    throw new Error("Token expired");
  }

  return payload;
}

function requireUser(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const claims = verifySessionJwt(match[1]);
    req.user = { account: claims.sub };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired authentication token" });
  }
}

function clearConsumedChallenges() {
  consumedChallenges.clear();
}

module.exports = {
  createChallenge,
  verifyChallengeAndIssueToken,
  signSessionJwt,
  verifySessionJwt,
  requireUser,
  clearConsumedChallenges,
};
