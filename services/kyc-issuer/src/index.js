/**
 * KYC Issuer Service
 */

"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRouter = require("./routes/auth");
const kycRouter = require("./routes/kyc");
const issuerRouter = require("./routes/issuer");
const store = require("./store");
const { rateLimit } = require("./lib/rateLimit");

const app = express();
app.disable("x-powered-by");

// Security headers for sensitive identity APIs
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  })
);

app.use(express.json({ limit: process.env.MAX_BODY_SIZE || "6mb" }));

const authLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 30),
});
const kycLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 30),
});
const issuerLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 60),
});

app.locals.resetRateLimiters = () => {
  authLimiter.reset();
  kycLimiter.reset();
  issuerLimiter.reset();
};

app.use("/api/auth", authLimiter, authRouter);
app.use("/api/kyc", kycLimiter, kycRouter);
app.use("/api/issuer", issuerLimiter, issuerRouter);

app.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));

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

if (require.main === module) {
  const sweepTimer = setInterval(() => store.purgeExpired(), 60_000);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`KYC Issuer running on :${PORT}`));
}

module.exports = app;
