/**
 * KYC Issuer Service
 *
 * Off-chain service that:
 *  1. Accepts KYC requests from users (documents, personal info)
 *  2. Reviews and approves/rejects requests
 *  3. Calls the VCVerifier Soroban contract to register attribute rings
 *  4. Returns BLS credentials to users (one-time retrieval)
 *
 * Architecture mirrors the 3-party model:
 *   Admin → registers issuers on-chain
 *   Issuer (this service) → verifies off-chain, writes rings on-chain
 *   User → proves attributes via ring signatures
 *
 * TODO for contributors:
 *  - Replace in-memory Maps with a proper encrypted database (e.g. PostgreSQL)
 *  - Add real document verification (OCR + liveness check integration)
 *  - Implement sanctions screening via Chainalysis / TRM Labs API
 *  - Add webhook notifications for request status changes
 *  - Rate-limit /request-kyc by IP
 */

"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const kycRouter = require("./routes/kyc");
const issuerRouter = require("./routes/issuer");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/kyc", kycRouter);
app.use("/api/issuer", issuerRouter);

app.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));

// ── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`KYC Issuer running on :${PORT}`));
}

module.exports = app; // for tests
