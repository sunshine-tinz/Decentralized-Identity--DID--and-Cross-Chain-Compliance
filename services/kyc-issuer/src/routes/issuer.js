/**
 * Issuer dashboard routes (issuer-facing)
 *
 * GET  /api/issuer/requests   — list pending requests for this issuer
 * POST /api/issuer/approve    — approve a request and issue credential
 * POST /api/issuer/reject     — reject a request
 *
 * TODO for contributors:
 *  - Authenticate issuer via SEP-10 JWT before exposing these routes
 *  - After approval, call VCVerifier.set_attribute_ring on Soroban
 *  - Add audit log for every approve/reject action
 */

"use strict";

const { Router } = require("express");
const store = require("../store");
const { buildCredential } = require("../lib/credential");

const router = Router();

/**
 * List pending KYC requests for a given issuer pubkey.
 * Query: ?issuerPubkey=<hex>
 */
router.get("/requests", (req, res) => {
  const { issuerPubkey } = req.query;
  if (!issuerPubkey) return res.status(400).json({ error: "issuerPubkey required" });

  const pending = [...store.kycRequests.values()].filter(
    (r) => r.issuerPubkey === issuerPubkey && r.status === "pending"
  );
  return res.json(pending);
});

/**
 * Approve a KYC request.
 *
 * Body: { requestId, issuerPubkey, issuerPrivkey }
 *
 * Steps:
 *  1. Build BLS ring credentials for each requested attribute
 *  2. TODO: call VCVerifier Soroban contract to register rings on-chain
 *  3. Store credential for one-time user retrieval
 */
router.post("/approve", async (req, res) => {
  const { requestId, issuerPubkey, issuerPrivkey } = req.body;
  const kycReq = store.kycRequests.get(requestId);

  if (!kycReq) return res.status(404).json({ error: "Request not found" });
  if (kycReq.issuerPubkey !== issuerPubkey) return res.status(403).json({ error: "Forbidden" });

  try {
    // TODO: call Soroban VCVerifier.set_attribute_ring for each attribute
    const credential = await buildCredential(kycReq, issuerPrivkey);

    kycReq.status = "approved";
    store.issuedCredentials.set(kycReq.userId, credential);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Reject a KYC request.
 */
router.post("/reject", (req, res) => {
  const { requestId, issuerPubkey, reason } = req.body;
  const kycReq = store.kycRequests.get(requestId);

  if (!kycReq) return res.status(404).json({ error: "Request not found" });
  if (kycReq.issuerPubkey !== issuerPubkey) return res.status(403).json({ error: "Forbidden" });

  kycReq.status = "rejected";
  kycReq.rejectionReason = reason;
  return res.json({ success: true });
});

module.exports = router;
