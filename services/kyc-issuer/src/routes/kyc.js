/**
 * KYC request routes (user-facing, SEP-10 authenticated)
 *
 * POST   /api/kyc/request          — submit an encrypted KYC request
 * GET    /api/kyc/status/:id       — poll request status (owner only, no PII)
 * GET    /api/kyc/credential/:token — one-time credential retrieval (owner only)
 * DELETE /api/kyc/request/:id      — erase PII and cancel/delete request (owner only)
 */

"use strict";

const { Router } = require("express");
const crypto = require("crypto");
const store = require("../store");
const { requireUser } = require("../lib/sep10");
const { validateKycRequest, isValidRetrievalToken } = require("../lib/validate");

const router = Router();

router.use(requireUser);

router.post("/request", (req, res) => {
  store.purgeExpired();

  const validation = validateKycRequest(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const { userId, subject, issuerPubkey, attributes, personalInfo, documentPhoto } =
    validation.value;

  if (req.user.account !== subject) {
    return res.status(403).json({ error: "Authenticated account does not own subject address" });
  }

  const requestId = crypto.randomUUID();
  const retrievalToken = crypto.randomUUID();

  try {
    store.saveKycRequest({
      requestId,
      userId,
      subject,
      issuerPubkey,
      attributes,
      personalInfo,
      documentPhoto,
      retrievalToken,
      status: "pending",
      createdAt: Date.now(),
    });
  } catch (err) {
    console.error("Failed to encrypt/store KYC request:", err && err.message);
    return res.status(503).json({ error: "KYC encryption storage is not configured" });
  }

  return res.json({ requestId, retrievalToken, status: "pending" });
});

router.get("/status/:requestId", (req, res) => {
  store.purgeExpired();
  const kycRequest = store.kycRequests.get(req.params.requestId);
  if (!kycRequest) return res.status(404).json({ error: "Not found" });

  if (req.user.account !== kycRequest.subject) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return res.json({
    status: kycRequest.status,
    requestId: kycRequest.requestId,
    piiPurged: Boolean(kycRequest.piiPurged),
    createdAt: kycRequest.createdAt,
  });
});

router.get("/credential/:token", (req, res) => {
  const { token } = req.params;
  if (!isValidRetrievalToken(token)) {
    return res.status(404).json({ error: "No credential available" });
  }

  let taken;
  try {
    taken = store.takeIssuedCredential(token);
  } catch (err) {
    console.error("Credential decryption failed:", err && err.message);
    return res.status(500).json({ error: "Credential unavailable" });
  }

  store.purgeExpired();

  if (!taken) {
    return res.status(404).json({ error: "No credential available" });
  }

  if (req.user.account !== taken.subject) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (taken.expired) {
    return res.status(410).json({ error: "Retrieval token expired" });
  }

  store.consumeIssuedCredential(token);
  if (taken.requestId) {
    store.scrubRequestPii(taken.requestId);
  }

  return res.json(taken.credential);
});

router.delete("/request/:requestId", (req, res) => {
  const kycRequest = store.kycRequests.get(req.params.requestId);
  if (!kycRequest) return res.status(404).json({ error: "Not found" });

  if (req.user.account !== kycRequest.subject) {
    return res.status(403).json({ error: "Forbidden" });
  }

  store.deleteKycRequest(req.params.requestId);
  return res.json({ deleted: true, requestId: req.params.requestId });
});

module.exports = router;
