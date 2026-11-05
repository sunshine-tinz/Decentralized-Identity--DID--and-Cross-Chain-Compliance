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
 * Approval submits `VCVerifier.issue_credential` for every requested attribute
 * using the server-held issuer key. If chain configuration is absent, issuance
 * fails closed with 503 unless PLACEHOLDER_ISSUANCE_ENABLED=true, in which case
 * the local, explicitly non-verifiable placeholder is produced instead (for
 * plumbing tests only).
 *
 * Storage remains in-memory (see store.js).
 */

"use strict";

const { Router } = require("express");
const store = require("../store");
const { buildCredential } = require("../lib/credential");
const { requireIssuer } = require("../lib/auth");
const { validateReason } = require("../lib/validate");
const {
  loadChainConfig,
  issueCredential,
  credentialExpiryLedger,
} = require("../lib/chain");

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
    subject: request.subject,
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

  const chain = loadChainConfig();
  const placeholderEnabled = process.env.PLACEHOLDER_ISSUANCE_ENABLED === "true";
  if (!chain && !placeholderEnabled) {
    return res.status(503).json({ error: "Credential issuance is not configured" });
  }

  if (chain) {
    // One transaction per attribute: the contract issues a single credential per
    // call. If a later attribute fails, earlier ones are already on-chain; the
    // request stays pending and a retry is safe because the issuer of record may
    // refresh its own attestation.
    let expiresAtLedger;
    const transactions = [];
    try {
      expiresAtLedger = await credentialExpiryLedger(chain);
      for (const attribute of kycReq.attributes) {
        const { hash } = await issueCredential(chain, {
          subject: kycReq.subject,
          attribute,
          expiresAt: expiresAtLedger,
        });
        transactions.push({ attribute, hash });
      }
    } catch (err) {
      console.error("On-chain issuance failed:", err.message);
      return res.status(502).json({ error: "On-chain credential issuance failed" });
    }

    kycReq.status = "approved";
    kycReq.decidedAt = Date.now();

    store.issuedCredentials.set(kycReq.retrievalToken, {
      scheme: "issuer-attested-soroban",
      verifiable: true,
      contractId: chain.contractId,
      issuer: chain.address,
      subject: kycReq.subject,
      attributes: kycReq.attributes,
      expiresAtLedger,
      transactions,
    });

    return res.json({
      success: true,
      onChain: true,
      attributeCount: kycReq.attributes.length,
      expiresAtLedger,
      transactions,
    });
  }

  try {
    const credential = await buildCredential(kycReq);
    kycReq.status = "approved";
    kycReq.decidedAt = Date.now();

    store.issuedCredentials.set(kycReq.retrievalToken, credential);

    return res.json({ success: true, onChain: false, attributeCount: kycReq.attributes.length });
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
