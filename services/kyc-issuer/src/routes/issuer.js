/**
 * Issuer dashboard routes (issuer-facing)
 *
 * GET  /api/issuer/requests         — list pending requests for the authenticated issuer (redacted)
 * GET  /api/issuer/requests/:id/pii — decrypt PII for authorized issuer review only
 * POST /api/issuer/approve          — approve a request and issue credentials atomically
 * POST /api/issuer/reject           — reject a request and scrub PII
 */

"use strict";

const { Router } = require("express");
const store = require("../store");
const { buildCredential, buildW3CVerifiableCredential } = require("../lib/credential");
const { requireIssuer } = require("../lib/auth");
const { validateReason } = require("../lib/validate");
const chainLib = require("../lib/chain");

const router = Router();

router.use(requireIssuer);

function toReviewView(request) {
  return {
    requestId: request.requestId,
    userId: request.userId,
    subject: request.subject,
    attributes: request.attributes,
    status: request.status,
    createdAt: request.createdAt,
    hasDocument: Boolean(request.hasDocument),
    piiPurged: Boolean(request.piiPurged),
  };
}

router.get("/requests", (req, res) => {
  store.purgeExpired();
  const { pubkey } = req.issuer;

  const pending = [...store.kycRequests.values()]
    .filter((r) => r.issuerPubkey === pubkey && r.status === "pending")
    .map(toReviewView);

  return res.json(pending);
});

router.get("/requests/:requestId/pii", (req, res) => {
  store.purgeExpired();
  const kycReq = store.kycRequests.get(req.params.requestId);
  if (!kycReq) return res.status(404).json({ error: "Request not found" });

  if (kycReq.issuerPubkey !== req.issuer.pubkey) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (kycReq.piiPurged) {
    return res.status(410).json({ error: "PII purged under retention policy" });
  }

  try {
    const pii = store.decryptRequestPii(kycReq);
    return res.json({
      requestId: kycReq.requestId,
      subject: kycReq.subject,
      personalInfo: pii.personalInfo,
      documentPhoto: pii.documentPhoto,
    });
  } catch (err) {
    console.error("Failed to decrypt PII for issuer review:", err && err.message);
    return res.status(500).json({ error: "Failed to decrypt request PII" });
  }
});

router.post("/approve", async (req, res) => {
  store.purgeExpired();
  const { requestId } = req.body || {};
  if (typeof requestId !== "string" || !requestId) {
    return res.status(400).json({ error: "requestId required" });
  }

  const kycReq = store.kycRequests.get(requestId);
  if (!kycReq) return res.status(404).json({ error: "Request not found" });

  if (kycReq.issuerPubkey !== req.issuer.pubkey) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (kycReq.status !== "pending") {
    return res.status(409).json({ error: `Request is already ${kycReq.status}` });
  }

  let chain;
  try {
    chain = chainLib.loadChainConfig(process.env, req.issuer.pubkey);
  } catch (err) {
    console.error("Chain configuration mismatch:", err && err.message);
    return res.status(500).json({ error: "Issuer signing identity mismatch" });
  }

  const placeholderEnabled = process.env.PLACEHOLDER_ISSUANCE_ENABLED === "true";
  if (!chain && !placeholderEnabled) {
    return res.status(503).json({ error: "Credential issuance is not configured" });
  }

  if (chain) {
    let expiresAtLedger;
    const transactions = [];
    try {
      expiresAtLedger = await chainLib.credentialExpiryLedger(chain);
      for (const attribute of kycReq.attributes) {
        const { hash } = await chainLib.issueCredential(chain, {
          subject: kycReq.subject,
          attribute,
          expiresAt: expiresAtLedger,
        });
        transactions.push({ attribute, hash });
      }
    } catch (err) {
      console.error("On-chain issuance failed:", err.message);
      // Compensating rollback for partial multi-attribute issuance.
      const rollbackFailures = [];
      for (const issued of transactions) {
        try {
          await chainLib.revokeCredential(chain, {
            subject: kycReq.subject,
            attribute: issued.attribute,
          });
        } catch (rbErr) {
          rollbackFailures.push(issued.attribute);
          console.error(
            `Compensating revocation failed for ${issued.attribute}:`,
            rbErr && rbErr.message
          );
        }
      }
      return res.status(502).json({
        error: "On-chain credential issuance failed",
        rolledBack: rollbackFailures.length === 0,
      });
    }

    kycReq.status = "approved";
    kycReq.decidedAt = Date.now();

    const w3cBundle =
      chain.keypair && typeof chain.keypair.sign === "function"
        ? buildW3CVerifiableCredential({
            requestId: kycReq.requestId,
            subject: kycReq.subject,
            attributes: kycReq.attributes,
            keypair: chain.keypair,
            contractId: chain.contractId,
            expiresAtLedger,
          })
        : null;

    store.saveIssuedCredential(kycReq.retrievalToken, {
      requestId: kycReq.requestId,
      subject: kycReq.subject,
      credential: {
        scheme: "issuer-attested-soroban",
        verifiable: true,
        contractId: chain.contractId,
        issuer: chain.address,
        subject: kycReq.subject,
        attributes: kycReq.attributes,
        expiresAtLedger,
        transactions,
        ...(w3cBundle || {}),
      },
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

    store.saveIssuedCredential(kycReq.retrievalToken, {
      requestId: kycReq.requestId,
      subject: kycReq.subject,
      credential,
    });

    return res.json({
      success: true,
      onChain: false,
      attributeCount: kycReq.attributes.length,
    });
  } catch (err) {
    console.error("Credential issuance failed:", err.message);
    return res.status(500).json({ error: "Credential issuance failed" });
  }
});

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
  store.scrubRequestPii(requestId);

  return res.json({ success: true });
});

module.exports = router;
