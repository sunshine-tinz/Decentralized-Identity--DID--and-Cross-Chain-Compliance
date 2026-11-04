/**
 * KYC Issuer Service
 *
 * Off-chain service that:
 *  1. Accepts KYC requests from users (documents, personal info)
 *  2. Reviews and approves/rejects requests (issuer-authenticated)
 *  3. Returns placeholder credentials to users (one-time retrieval by token)
 *
 * Architecture mirrors the 3-party model:
 *   Admin → registers issuers on-chain
 *   Issuer (this service) → verifies off-chain, writes rings on-chain
 *   User → proves attributes via ring signatures
 *
 * Known gaps (see AUDIT.md):
 *  - No on-chain call: the verifier cannot check BLS proofs yet
 *  - In-memory, unencrypted storage; no persistence or retention job
 *  - No SEP-10 JWT authentication (API keys are used instead)
 *  - Optional document verification / sanctions screening not integrated
 */

"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const kycRouter = require("./routes/kyc");
const issuerRouter = require("./routes/issuer");
const { rateLimit } = require("./lib/rateLimit");

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
// Only origins listed in CORS_ORIGIN may call this service from a browser.
// With no configuration, no cross-origin access is granted.
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  })
);

// Large KYC payloads must not be accepted from unauthenticated callers at the
// default 100kb limit; keep an explicit, bounded limit.
app.use(express.json({ limit: process.env.MAX_BODY_SIZE || "6mb" }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// The submission endpoint is unauthenticated by design (public intake), so it is
// the most attractive DoS target.
const submissionLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 30),
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/kyc/request", submissionLimiter);
app.use("/api/kyc", kycRouter);
app.use("/api/issuer", issuerRouter);

app.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));

// ── Error handling ────────────────────────────────────────────────────────────
// Malformed JSON and unexpected errors must not leak stack traces or internals.
app.use((err, _req, res, _next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large" });
  }
  if (err && (err.status === 400 || err.type === "entity.parse.failed")) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  console.error("Unhandled error:", err && err.message);
  return res.status(500).json({ error: "Internal error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`KYC Issuer running on :${PORT}`));
}

module.exports = app; // for tests
