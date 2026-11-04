/**
 * KYC request routes (user-facing)
 *
 * POST /api/kyc/request          — submit a KYC request
 * GET  /api/kyc/status/:id       — poll request status
 * GET  /api/kyc/credential/:token — one-time credential retrieval
 *
 * No endpoint here trusts a caller-supplied identifier as an authorisation
 * token. Credential retrieval is keyed on a high-entropy token generated at
 * submission time and returned exactly once to the submitter.
 */

"use strict";

const { Router } = require("express");
const crypto = require("crypto");
const store = require("../store");
const { validateKycRequest, isValidRetrievalToken } = require("../lib/validate");

const router = Router();

/**
 * Submit a KYC request.
 *
 * Body: { userId, issuerPubkey, attributes: string[], personalInfo?: {}, documentPhoto?: base64 }
 * Response: { requestId, retrievalToken }
 *
 * The retrieval token is the only way to collect the resulting credential.
 * Treat it as a secret.
 */
router.post("/request", (req, res) => {
  const validation = validateKycRequest(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const { userId, issuerPubkey, attributes, personalInfo, documentPhoto } =
    validation.value;

  const requestId = crypto.randomUUID();
  const retrievalToken = crypto.randomUUID();

  store.kycRequests.set(requestId, {
    requestId,
    userId,
    issuerPubkey,
    attributes,
    personalInfo,
    documentPhoto,
    retrievalToken,
    status: "pending",
    createdAt: Date.now(),
  });

  return res.json({ requestId, retrievalToken });
});

/**
 * Poll request status. Returns status only — never personal data.
 */
router.get("/status/:requestId", (req, res) => {
  const kycRequest = store.kycRequests.get(req.params.requestId);
  if (!kycRequest) return res.status(404).json({ error: "Not found" });

  return res.json({
    status: kycRequest.status,
    requestId: kycRequest.requestId,
    createdAt: kycRequest.createdAt,
  });
});

/**
 * One-time credential retrieval.
 *
 * Requires the unguessable token issued at submission time, and deletes the
 * credential after a successful read. A caller cannot consume another person's
 * credential by knowing their userId, and cannot enumerate tokens.
 */
router.get("/credential/:token", (req, res) => {
  const { token } = req.params;
  if (!isValidRetrievalToken(token)) {
    return res.status(404).json({ error: "No credential available" });
  }

  const credential = store.issuedCredentials.get(token);
  if (!credential) return res.status(404).json({ error: "No credential available" });

  store.issuedCredentials.delete(token);
  return res.json(credential);
});

module.exports = router;
