/**
 * Issuer dashboard routes (issuer-facing)
 *
 * GET  /api/issuer/requests   — list pending requests for the authenticated issuer
 * POST /api/issuer/approve    — approve a request and issue a credential
 * POST /api/issuer/reject     — reject a request
 *
 * All routes require a valid issuer API key (`x-issuer-key`). The issuer's public
 * key is resolved server-side from that key, so a caller cannot act as an issuer
 * by quoting a public key. No private key material is accepted over HTTP.
 *
 * Storage remains in-memory (see store.js) and there is no on-chain call yet: the
 * verifier cannot check BLS proofs (AUDIT.md C-2/C-3), so issuance is disabled
 * unless PLACEHOLDER_ISSUANCE_ENABLED=true.
 */

"use strict";

const { Router } = require("express");
const store = require("../store");
const { buildCredential } = require("../lib/credential");
const { requireIssuer } = require("../lib/auth");
const { validateReason } = require("../lib/validate");

const router = Router();

router.use(requireIssuer);

/**
 * Project a stored request down to non-sensitive review metadata.
 * Personal information and documents are deliberately never included.
 * @param {object} request
 */
function toReviewView(request) {
  return {
    requestId: request.requestId,
    userId: request.userId,
    attributes: request.attributes,
    status: request.status,
    createdAt: request.createdAt,
    hasDocument: Boolean(request.documentPhoto),
  };
}

/**
 * List pending KYC requests for the authenticated issuer.
 */
router.get("/requests", (req, res) => {
  const { pubkey } = req.issuer;

  const pending = [...store.kycRequests.values()]
    .filter((r) => r.issuerPubkey === pubkey && r.status === "pending")
    .map(toReviewView);

  return res.json(pending);
});

/**
 * Approve a KYC request.
 *
 * Body: { requestId }
 */
router.post("/approve", async (req, res) => {
  const { requestId } = req.body || {};
  if (typeof requestId !== "string" || !requestId) {
    return res.status(400).json({ error: "requestId required" });
  }

  if (process.env.PLACEHOLDER_ISSUANCE_ENABLED !== "true") {
    return res.status(501).json({
      error:
        "Credential issuance is not available: BLS12-381 ring credentials are not implemented",
    });
  }

  const kycReq = store.kycRequests.get(requestId);
  if (!kycReq) return res.status(404).json({ error: "Request not found" });

  if (kycReq.issuerPubkey !== req.issuer.pubkey) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Only `pending` may be approved; prevents double issuance and reviving a
  // rejected request.
  if (kycReq.status !== "pending") {
    return res.status(409).json({ error: `Request is already ${kycReq.status}` });
  }

  try {
    const credential = await buildCredential(kycReq);
    kycReq.status = "approved";
    kycReq.decidedAt = Date.now();

    store.issuedCredentials.set(kycReq.retrievalToken, credential);

    return res.json({ success: true, attributeCount: kycReq.attributes.length });
  } catch (err) {
    // Never echo internal error details to the client.
    console.error("Credential issuance failed:", err.message);
    return res.status(500).json({ error: "Credential issuance failed" });
  }
});

/**
 * Reject a KYC request.
 *
 * Body: { requestId, reason? }
 */
router.post("/reject", (req, res) => {
  const { requestId, reason } = req.body || {};
  if (typeof requestId !== "string" || !requestId) {
    return res.status(400).json({ error: "requestId required" });
  }

  const reasonCheck = validateReason(reason);
  if (!reasonCheck.ok) return res.status(400).json({ error: reasonCheck.error });

  const kycReq = store.kycRequests.get(requestId);
  if (!kycReq) return res.status(404).json({ error: "Request not found" });

  if (kycReq.issuerPubkey !== req.issuer.pubkey) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (kycReq.status !== "pending") {
    return res.status(409).json({ error: `Request is already ${kycReq.status}` });
  }

  kycReq.status = "rejected";
  kycReq.rejectionReason = reasonCheck.value;
  kycReq.decidedAt = Date.now();

  return res.json({ success: true });
});

module.exports = router;
