/**
 * KYC request routes (user-facing)
 *
 * POST /api/kyc/request   — submit a KYC request
 * GET  /api/kyc/status/:id — poll request status
 * GET  /api/kyc/credential/:userId — one-time credential retrieval
 */

"use strict";

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const store = require("../store");

const router = Router();

/**
 * Submit a KYC request.
 *
 * Body: { userId, issuerPubkey, attributes: string[], personalInfo: {}, documentPhoto: base64 }
 *
 * TODO: validate issuerPubkey is a registered issuer (192-char hex BLS key)
 * TODO: add input sanitisation and file-size limits
 */
router.post("/request", (req, res) => {
  const { userId, issuerPubkey, attributes, personalInfo, documentPhoto } = req.body;

  if (!userId || !issuerPubkey || !Array.isArray(attributes) || attributes.length === 0) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const requestId = uuidv4();
  store.kycRequests.set(requestId, {
    requestId,
    userId,
    issuerPubkey,
    attributes,
    personalInfo,   // TODO: encrypt at rest
    documentPhoto,  // TODO: store in object storage, keep only reference here
    status: "pending",
    createdAt: Date.now(),
  });

  return res.json({ requestId });
});

/**
 * Poll request status.
 */
router.get("/status/:requestId", (req, res) => {
  const req_ = store.kycRequests.get(req.params.requestId);
  if (!req_) return res.status(404).json({ error: "Not found" });
  return res.json({ status: req_.status, requestId: req_.requestId });
});

/**
 * One-time credential retrieval.
 * Deletes the credential from the store after returning it.
 */
router.get("/credential/:userId", (req, res) => {
  const cred = store.issuedCredentials.get(req.params.userId);
  if (!cred) return res.status(404).json({ error: "No credential available" });

  store.issuedCredentials.delete(req.params.userId); // one-time retrieval
  return res.json(cred);
});

module.exports = router;
