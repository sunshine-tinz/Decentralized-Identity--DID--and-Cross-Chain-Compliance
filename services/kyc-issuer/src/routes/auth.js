/**
 * SEP-10 Authentication Routes
 *
 * GET  /api/auth/challenge?account=G... — issue signed SEP-10 challenge XDR
 * POST /api/auth/token                  — verify signed challenge, issue JWT
 */

"use strict";

const { Router } = require("express");
const { createChallenge, verifyChallengeAndIssueToken } = require("../lib/sep10");

const router = Router();

router.get("/challenge", (req, res) => {
  try {
    const challenge = createChallenge(req.query.account);
    return res.json(challenge);
  } catch (err) {
    const msg = err && err.message ? err.message : "Invalid challenge request";
    const status = msg.includes("not configured") ? 503 : 400;
    return res.status(status).json({ error: msg });
  }
});

router.post("/token", (req, res) => {
  const { transaction } = req.body || {};
  try {
    const result = verifyChallengeAndIssueToken(transaction);
    return res.json(result);
  } catch (err) {
    const msg = err && err.message ? err.message : "Authentication failed";
    const status = msg.includes("not configured") ? 503 : 401;
    return res.status(status).json({ error: msg });
  }
});

module.exports = router;
