"use strict";

const request = require("supertest");
const { Keypair, Networks, TransactionBuilder } = require("@stellar/stellar-sdk");
const app = require("../src/index");
const store = require("../src/store");
const { clearConsumedChallenges } = require("../src/lib/sep10");
const chain = require("../src/lib/chain");

const ISSUER_KEY = "test-issuer-key";
const ISSUER_KEY_2 = "test-issuer-key-v2";
const ISSUER_PUBKEY = "a".repeat(192);
const OTHER_PUBKEY = "b".repeat(192);

const SUBJECT_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const SUBJECT = SUBJECT_KP.publicKey();
const OTHER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
const SEP10_SERVER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));

const ENC_KEY_1 = "11".repeat(32);
const ENC_KEY_2 = "22".repeat(32);

async function authenticateAs(kp = SUBJECT_KP) {
  const ch = await request(app)
    .get("/api/auth/challenge")
    .query({ account: kp.publicKey() });
  expect(ch.status).toBe(200);

  const tx = TransactionBuilder.fromXDR(ch.body.transaction, Networks.TESTNET);
  tx.sign(kp);

  const tok = await request(app)
    .post("/api/auth/token")
    .send({ transaction: tx.toXDR() });
  expect(tok.status).toBe(200);
  return tok.body.token;
}

beforeEach(() => {
  store.kycRequests.clear();
  store.issuedCredentials.clear();
  clearConsumedChallenges();
  if (typeof app.locals.resetRateLimiters === "function") {
    app.locals.resetRateLimiters();
  }

  process.env.ISSUER_KEYS = `${ISSUER_KEY}:${ISSUER_PUBKEY}`;
  process.env.PLACEHOLDER_ISSUANCE_ENABLED = "true";
  process.env.KYC_ENCRYPTION_KEYS = `k1:${ENC_KEY_1}`;
  process.env.SEP10_SIGNING_KEY = SEP10_SERVER_KP.secret();
  process.env.SEP10_JWT_SECRET = "test-jwt-secret-key-for-unit-tests";
  process.env.NETWORK_PASSPHRASE = Networks.TESTNET;
  delete process.env.ALLOWED_ATTRIBUTES;
  delete process.env.PII_RETENTION_MS;
  delete process.env.RETRIEVAL_TOKEN_TTL_MS;

  vi.restoreAllMocks();
  vi.spyOn(chain, "loadChainConfig").mockReturnValue(null);
  vi.spyOn(chain, "issueCredential");
  vi.spyOn(chain, "revokeCredential");
  vi.spyOn(chain, "credentialExpiryLedger");
});

afterEach(() => {
  delete process.env.ISSUER_KEYS;
  delete process.env.PLACEHOLDER_ISSUANCE_ENABLED;
  delete process.env.KYC_ENCRYPTION_KEYS;
  delete process.env.SEP10_SIGNING_KEY;
  delete process.env.SEP10_JWT_SECRET;
  delete process.env.ALLOWED_ATTRIBUTES;
  delete process.env.PII_RETENTION_MS;
  delete process.env.RETRIEVAL_TOKEN_TTL_MS;
});

function submit(token, overrides = {}) {
  const req = request(app).post("/api/kyc/request");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send({
    userId: "user-1",
    subject: SUBJECT,
    issuerPubkey: ISSUER_PUBKEY,
    attributes: ["kyc_passed"],
    personalInfo: { name: "Alice", email_address: "alice@example.com" },
    documentPhoto: "ZmFrZS1pbWFnZQ==",
    ...overrides,
  });
}

async function approvedRequest(token) {
  const response = await submit(token);
  const { requestId, retrievalToken } = response.body;
  await request(app)
    .post("/api/issuer/approve")
    .set("x-issuer-key", ISSUER_KEY)
    .send({ requestId });
  return { requestId, retrievalToken };
}

describe("SEP-10 Authentication & Authorization", () => {
  it("rejects unauthenticated requests to protected KYC endpoints", async () => {
    expect((await submit(null)).status).toBe(401);
    expect((await request(app).get("/api/kyc/status/some-id")).status).toBe(401);
    expect(
      (await request(app).get("/api/kyc/credential/3f2504e0-4f89-41d3-9a0c-0305e82c3302")).status
    ).toBe(401);
    expect((await request(app).delete("/api/kyc/request/some-id")).status).toBe(401);
  });

  it("rejects invalid, unsigned, wrong-signer, and replayed SEP-10 challenges", async () => {
    const ch = await request(app)
      .get("/api/auth/challenge")
      .query({ account: SUBJECT });
    expect(ch.status).toBe(200);

    // Unsigned challenge
    const unsigned = await request(app)
      .post("/api/auth/token")
      .send({ transaction: ch.body.transaction });
    expect(unsigned.status).toBe(401);

    // Signed by wrong keypair
    const wrongTx = TransactionBuilder.fromXDR(ch.body.transaction, Networks.TESTNET);
    wrongTx.sign(OTHER_KP);
    const wrong = await request(app)
      .post("/api/auth/token")
      .send({ transaction: wrongTx.toXDR() });
    expect(wrong.status).toBe(401);

    // Valid signature succeeds once, replay fails
    const validTx = TransactionBuilder.fromXDR(ch.body.transaction, Networks.TESTNET);
    validTx.sign(SUBJECT_KP);
    const first = await request(app)
      .post("/api/auth/token")
      .send({ transaction: validTx.toXDR() });
    expect(first.status).toBe(200);
    expect(first.body.account).toBe(SUBJECT);

    const replay = await request(app)
      .post("/api/auth/token")
      .send({ transaction: validTx.toXDR() });
    expect(replay.status).toBe(401);
  });

  it("rejects subject ownership mismatch on submission, status, retrieval, and deletion", async () => {
    const subjectToken = await authenticateAs(SUBJECT_KP);
    const otherToken = await authenticateAs(OTHER_KP);

    // Other user cannot submit for SUBJECT
    const spoofed = await submit(otherToken, { subject: SUBJECT });
    expect(spoofed.status).toBe(403);

    const { requestId, retrievalToken } = await approvedRequest(subjectToken);

    expect(
      (await request(app).get(`/api/kyc/status/${requestId}`).set("Authorization", `Bearer ${otherToken}`))
        .status
    ).toBe(403);

    // Unauthorized retrieval returns 403 and does NOT consume the token
    expect(
      (
        await request(app)
          .get(`/api/kyc/credential/${retrievalToken}`)
          .set("Authorization", `Bearer ${otherToken}`)
      ).status
    ).toBe(403);

    expect(
      (
        await request(app)
          .delete(`/api/kyc/request/${requestId}`)
          .set("Authorization", `Bearer ${otherToken}`)
      ).status
    ).toBe(403);

    // Legitimate owner can still retrieve
    const ok = await request(app)
      .get(`/api/kyc/credential/${retrievalToken}`)
      .set("Authorization", `Bearer ${subjectToken}`);
    expect(ok.status).toBe(200);
  });
});

describe("Encryption at rest, key rotation, retention, and deletion", () => {
  it("encrypts PII at rest and allows authorized issuer decryption", async () => {
    const token = await authenticateAs(SUBJECT_KP);
    const res = await submit(token);
    expect(res.status).toBe(200);

    const rawStored = store.kycRequests.get(res.body.requestId);
    expect(rawStored.personalInfo).toBeUndefined();
    expect(rawStored.documentPhoto).toBeUndefined();
    expect(JSON.stringify(rawStored)).not.toContain("Alice");
    expect(JSON.stringify(rawStored)).not.toContain("ZmFrZS1pbWFnZQ==");
    expect(rawStored.encryptedPersonalInfo.alg).toBe("aes-256-gcm");
    expect(rawStored.encryptedPersonalInfo.keyId).toBe("k1");

    // Authorized issuer can decrypt for review
    const pii = await request(app)
      .get(`/api/issuer/requests/${res.body.requestId}/pii`)
      .set("x-issuer-key", ISSUER_KEY);
    expect(pii.status).toBe(200);
    expect(pii.body.personalInfo.name).toBe("Alice");
    expect(pii.body.documentPhoto).toBe("ZmFrZS1pbWFnZQ==");

    // Unauthorized caller cannot access PII
    expect(
      (await request(app).get(`/api/issuer/requests/${res.body.requestId}/pii`)).status
    ).toBe(401);
  });

  it("supports encryption key rotation and re-encryption without breaking reads", async () => {
    const token = await authenticateAs(SUBJECT_KP);
    const res = await submit(token);

    process.env.KYC_ENCRYPTION_KEYS = `k2:${ENC_KEY_2},k1:${ENC_KEY_1}`;
    const rotatedCount = store.rotateAllEncryptionKeys();
    expect(rotatedCount).toBe(1);

    const stored = store.kycRequests.get(res.body.requestId);
    expect(stored.encryptedPersonalInfo.keyId).toBe("k2");

    // Still decryptable after removing k1
    process.env.KYC_ENCRYPTION_KEYS = `k2:${ENC_KEY_2}`;
    const pii = await request(app)
      .get(`/api/issuer/requests/${res.body.requestId}/pii`)
      .set("x-issuer-key", ISSUER_KEY);
    expect(pii.status).toBe(200);
    expect(pii.body.personalInfo.email_address).toBe("alice@example.com");
  });

  it("rejects expired retrieval tokens and enforces single-use + PII scrubbing", async () => {
    const token = await authenticateAs(SUBJECT_KP);
    process.env.RETRIEVAL_TOKEN_TTL_MS = "100";
    const { requestId, retrievalToken } = await approvedRequest(token);

    // Force expiration
    const entry = store.issuedCredentials.get(retrievalToken);
    entry.expiresAt = Date.now() - 10;

    const expired = await request(app)
      .get(`/api/kyc/credential/${retrievalToken}`)
      .set("Authorization", `Bearer ${token}`);
    expect(expired.status).toBe(410);

    // Fresh approval: single-use retrieval scrubs PII and rejects reuse
    delete process.env.RETRIEVAL_TOKEN_TTL_MS;
    const fresh = await approvedRequest(token);
    const first = await request(app)
      .get(`/api/kyc/credential/${fresh.retrievalToken}`)
      .set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(store.kycRequests.get(fresh.requestId).piiPurged).toBe(true);
    expect(store.kycRequests.get(fresh.requestId).encryptedPersonalInfo).toBeNull();

    const second = await request(app)
      .get(`/api/kyc/credential/${fresh.retrievalToken}`)
      .set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(404);
    expect(requestId).toBeDefined();
  });

  it("purges expired PII automatically and supports owner deletion", async () => {
    const token = await authenticateAs(SUBJECT_KP);
    const res1 = await submit(token);
    const stored = store.kycRequests.get(res1.body.requestId);
    stored.piiExpiresAt = Date.now() - 1;

    const purged = store.purgeExpired(Date.now());
    expect(purged.scrubbedCount).toBe(1);
    expect(store.kycRequests.get(res1.body.requestId).piiPurged).toBe(true);

    // Owner DELETE removes request and credential completely
    const res2 = await submit(token);
    const del = await request(app)
      .delete(`/api/kyc/request/${res2.body.requestId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(store.kycRequests.has(res2.body.requestId)).toBe(false);
  });
});

describe("Input validation, Issuer Auth, Rotation, and Partial Failure Rollback", () => {
  it("validates fields and bounds", async () => {
    const token = await authenticateAs(SUBJECT_KP);
    expect((await submit(token, { attributes: [] })).status).toBe(400);
    expect((await submit(token, { issuerPubkey: "bad" })).status).toBe(400);
    expect((await submit(token, { attributes: ["admin_override"] })).status).toBe(400);
    expect((await submit(token, { userId: "../../etc/passwd" })).status).toBe(400);
    expect(
      (await submit(token, { documentPhoto: "A".repeat(4 * 1024 * 1024 + 1) })).status
    ).toBe(400);
  });

  it("lists redacted pending requests and supports issuer API key rotation", async () => {
    const token = await authenticateAs(SUBJECT_KP);
    await submit(token, { userId: "user-1" });
    await submit(token, { userId: "user-9", issuerPubkey: OTHER_PUBKEY });

    process.env.ISSUER_KEYS = `${ISSUER_KEY_2}:${ISSUER_PUBKEY}`;

    expect(
      (await request(app).get("/api/issuer/requests").set("x-issuer-key", ISSUER_KEY)).status
    ).toBe(401);

    const res = await request(app)
      .get("/api/issuer/requests")
      .set("x-issuer-key", ISSUER_KEY_2);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].personalInfo).toBeUndefined();
    expect(res.body[0].documentPhoto).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("Alice");
  });

  it("enforces issuer state transitions and fails closed when unconfigured", async () => {
    const token = await authenticateAs(SUBJECT_KP);
    const { body } = await submit(token);
    delete process.env.PLACEHOLDER_ISSUANCE_ENABLED;

    const fail = await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: body.requestId });
    expect(fail.status).toBe(503);

    process.env.PLACEHOLDER_ISSUANCE_ENABLED = "true";
    const { requestId } = await approvedRequest(token);
    const doubleApprove = await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId });
    expect(doubleApprove.status).toBe(409);

    const rejAfterApprove = await request(app)
      .post("/api/issuer/reject")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId, reason: "late" });
    expect(rejAfterApprove.status).toBe(409);
  });

  it("rolls back earlier attributes when multi-attribute on-chain issuance partially fails", async () => {
    const token = await authenticateAs(SUBJECT_KP);
    const { body } = await submit(token, { attributes: ["kyc_passed", "over_18"] });

    const CHAIN = {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      address: SUBJECT,
      keypair: { publicKey: () => SUBJECT },
      ttlLedgers: 518_400,
    };
    chain.loadChainConfig.mockReturnValue(CHAIN);
    chain.credentialExpiryLedger.mockResolvedValue(9_000);
    chain.issueCredential
      .mockResolvedValueOnce({ hash: "tx-attr-1", ledger: 500 })
      .mockRejectedValueOnce(new Error("host trap: secret detail"));
    chain.revokeCredential.mockResolvedValue({ hash: "tx-rollback-1", ledger: 501 });

    const res = await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: body.requestId });

    expect(res.status).toBe(502);
    expect(res.body.error).not.toMatch(/secret detail/);
    expect(res.body.rolledBack).toBe(true);
    expect(chain.revokeCredential).toHaveBeenCalledTimes(1);
    expect(chain.revokeCredential).toHaveBeenCalledWith(CHAIN, {
      subject: SUBJECT,
      attribute: "kyc_passed",
    });

    const status = await request(app)
      .get(`/api/kyc/status/${body.requestId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(status.body.status).toBe("pending");
  });

  it("succeeds on-chain issuance for multiple attributes", async () => {
    const token = await authenticateAs(SUBJECT_KP);
    const { body } = await submit(token, { attributes: ["kyc_passed", "over_18"] });

    const CHAIN = {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      address: SUBJECT,
      keypair: SUBJECT_KP,
      ttlLedgers: 518_400,
    };
    chain.loadChainConfig.mockReturnValue(CHAIN);
    chain.credentialExpiryLedger.mockResolvedValue(9_000);
    chain.issueCredential.mockResolvedValue({ hash: "deadbeef", ledger: 500 });

    const res = await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: body.requestId });

    expect(res.status).toBe(200);
    expect(res.body.onChain).toBe(true);
    expect(res.body.transactions).toHaveLength(2);

    const retrieved = await request(app)
      .get(`/api/kyc/credential/${body.retrievalToken}`)
      .set("Authorization", `Bearer ${token}`);
    expect(retrieved.status).toBe(200);
    expect(retrieved.body.verifiableCredential).toBeDefined();
    expect(retrieved.body.verifiableCredential.proof.type).toBe("Ed25519Signature2020");
    expect(retrieved.body.vcHashHex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
