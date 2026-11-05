"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const app = require("../src/index");
const store = require("../src/store");

jest.mock("../src/lib/chain", () => ({
  loadChainConfig: jest.fn(),
  issueCredential: jest.fn(),
  credentialExpiryLedger: jest.fn(),
}));

const chain = require("../src/lib/chain");

const ISSUER_KEY = "test-issuer-key";
const ISSUER_PUBKEY = "a".repeat(192);
const OTHER_PUBKEY = "b".repeat(192);
const SUBJECT = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();

beforeEach(() => {
  store.kycRequests.clear();
  store.issuedCredentials.clear();
  process.env.ISSUER_KEYS = `${ISSUER_KEY}:${ISSUER_PUBKEY}`;
  process.env.PLACEHOLDER_ISSUANCE_ENABLED = "true";
  delete process.env.ALLOWED_ATTRIBUTES;

  // Default: no chain configuration, placeholder mode enabled.
  chain.loadChainConfig.mockReset();
  chain.loadChainConfig.mockReturnValue(null);
  chain.issueCredential.mockReset();
  chain.credentialExpiryLedger.mockReset();
});

afterEach(() => {
  delete process.env.ISSUER_KEYS;
  delete process.env.PLACEHOLDER_ISSUANCE_ENABLED;
  delete process.env.ALLOWED_ATTRIBUTES;
});

function submit(overrides = {}) {
  return request(app)
    .post("/api/kyc/request")
    .send({
      userId: "user-1",
      subject: SUBJECT,
      issuerPubkey: ISSUER_PUBKEY,
      attributes: ["kyc_passed"],
      personalInfo: { name: "Alice", email_address: "alice@example.com" },
      documentPhoto: "ZmFrZS1pbWFnZQ==",
      ...overrides,
    });
}

async function approvedRequest() {
  const response = await submit();
  const { requestId, retrievalToken } = response.body;
  await request(app)
    .post("/api/issuer/approve")
    .set("x-issuer-key", ISSUER_KEY)
    .send({ requestId });
  return { requestId, retrievalToken };
}

describe("POST /api/kyc/request", () => {
  it("creates a pending request and returns a retrieval token", async () => {
    const res = await submit();
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeDefined();
    expect(res.body.retrievalToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(store.kycRequests.size).toBe(1);
  });

  it("rejects missing fields", async () => {
    const res = await request(app).post("/api/kyc/request").send({ userId: "u1" });
    expect(res.status).toBe(400);
  });

  it("rejects empty attributes array", async () => {
    const res = await submit({ attributes: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed issuer public key", async () => {
    const res = await submit({ issuerPubkey: "not-a-key" });
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported attribute", async () => {
    const res = await submit({ attributes: ["admin_override"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported attribute/);
  });

  it("rejects duplicate attributes", async () => {
    const res = await submit({ attributes: ["kyc_passed", "kyc_passed"] });
    expect(res.status).toBe(400);
  });

  it("rejects an unsafe userId", async () => {
    const res = await submit({ userId: "../../etc/passwd" });
    expect(res.status).toBe(400);
  });

  it("requires a valid Stellar subject address", async () => {
    const missing = await request(app).post("/api/kyc/request").send({
      userId: "user-1",
      issuerPubkey: ISSUER_PUBKEY,
      attributes: ["kyc_passed"],
    });
    expect(missing.status).toBe(400);

    const invalid = await submit({ subject: "not-an-address" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatch(/subject/);
  });

  it("rejects an oversized document", async () => {
    const res = await submit({ documentPhoto: "A".repeat(4 * 1024 * 1024 + 1) });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/kyc/status/:requestId", () => {
  it("returns pending status for a new request", async () => {
    const post = await submit({ userId: "user-2" });
    const res = await request(app).get(`/api/kyc/status/${post.body.requestId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
    expect(res.body.personalInfo).toBeUndefined();
  });

  it("returns 404 for unknown requestId", async () => {
    const res = await request(app).get("/api/kyc/status/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("credential retrieval", () => {
  it("returns the credential once, using the retrieval token", async () => {
    const { retrievalToken } = await approvedRequest();

    const first = await request(app).get(`/api/kyc/credential/${retrievalToken}`);
    expect(first.status).toBe(200);
    expect(first.body.userId).toBe("user-1");
    expect(first.body.scheme).toBe("placeholder-bls12-381");
    expect(first.body.verifiable).toBe(false);

    const second = await request(app).get(`/api/kyc/credential/${retrievalToken}`);
    expect(second.status).toBe(404);
  });

  it("does not expose credentials by userId (IDOR regression)", async () => {
    // Regression for AUDIT.md C-8: /credential/:userId let anyone who knew a
    // userId fetch — and, because reads delete, destroy — another credential.
    const { retrievalToken } = await approvedRequest();

    const byUserId = await request(app).get("/api/kyc/credential/user-1");
    expect(byUserId.status).toBe(404);

    // The legitimate token still works.
    const byToken = await request(app).get(`/api/kyc/credential/${retrievalToken}`);
    expect(byToken.status).toBe(200);
  });

  it("returns 404 for a non-token value", async () => {
    const res = await request(app).get("/api/kyc/credential/not-a-token");
    expect(res.status).toBe(404);
  });

  it("one user cannot consume another user's credential", async () => {
    const victim = await submit({ userId: "victim" });
    await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: victim.body.requestId });

    // Attacker knows the victim's userId but not the token.
    const res = await request(app).get("/api/kyc/credential/victim");
    expect(res.status).toBe(404);

    const stillThere = await request(app).get(
      `/api/kyc/credential/${victim.body.retrievalToken}`
    );
    expect(stillThere.status).toBe(200);
  });
});

describe("GET /api/issuer/requests", () => {
  it("requires authentication", async () => {
    const res = await request(app).get(`/api/issuer/requests?issuerPubkey=${ISSUER_PUBKEY}`);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid API key", async () => {
    const res = await request(app)
      .get("/api/issuer/requests")
      .set("x-issuer-key", "wrong-key");
    expect(res.status).toBe(401);
  });

  it("lists only this issuer's pending requests, redacted", async () => {
    await submit({ userId: "user-1" });
    await submit({ userId: "user-9", issuerPubkey: OTHER_PUBKEY });

    const res = await request(app)
      .get("/api/issuer/requests")
      .set("x-issuer-key", ISSUER_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].userId).toBe("user-1");
    expect(res.body[0].hasDocument).toBe(true);

    // Regression for AUDIT.md C-9: PII must never appear in the listing.
    expect(res.body[0].personalInfo).toBeUndefined();
    expect(res.body[0].documentPhoto).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("Alice");
  });
});

describe("POST /api/issuer/approve", () => {
  it("requires authentication", async () => {
    const { body } = await submit();
    const res = await request(app)
      .post("/api/issuer/approve")
      .send({ requestId: body.requestId });
    expect(res.status).toBe(401);
  });

  it("does not accept private key material", async () => {
    const { body } = await submit();
    const res = await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: body.requestId, issuerPrivkey: "f".repeat(64) });
    expect(res.status).toBe(200);
    // The response must not contain or reference key material.
    expect(JSON.stringify(res.body)).not.toContain("f".repeat(64));
  });

  it("refuses issues for another issuer's request", async () => {
    const { body } = await submit({ issuerPubkey: OTHER_PUBKEY });
    const res = await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: body.requestId });
    expect(res.status).toBe(403);
  });

  it("fails closed with 503 when neither chain nor placeholder is configured", async () => {
    const { body } = await submit();
    delete process.env.PLACEHOLDER_ISSUANCE_ENABLED;

    const res = await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: body.requestId });
    expect(res.status).toBe(503);
  });

  it("cannot be approved twice", async () => {
    const { requestId } = await approvedRequest();
    const res = await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId });
    expect(res.status).toBe(409);
  });

  it("cannot approve a rejected request", async () => {
    const { body } = await submit();
    await request(app)
      .post("/api/issuer/reject")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: body.requestId, reason: "blurry document" });

    const res = await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: body.requestId });
    expect(res.status).toBe(409);
  });

  it("returns 404 for an unknown request", async () => {
    const res = await request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/issuer/reject", () => {
  it("rejects a pending request", async () => {
    const { body } = await submit();
    const res = await request(app)
      .post("/api/issuer/reject")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId: body.requestId, reason: "document unreadable" });
    expect(res.status).toBe(200);

    const status = await request(app).get(`/api/kyc/status/${body.requestId}`);
    expect(status.body.status).toBe("rejected");
  });

  it("requires authentication", async () => {
    const { body } = await submit();
    const res = await request(app)
      .post("/api/issuer/reject")
      .send({ requestId: body.requestId });
    expect(res.status).toBe(401);
  });

  it("cannot reject an already approved request", async () => {
    const { requestId } = await approvedRequest();
    const res = await request(app)
      .post("/api/issuer/reject")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId, reason: "changed my mind" });
    expect(res.status).toBe(409);
  });
});

describe("on-chain issuance", () => {
  const CHAIN = {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    address: SUBJECT,
    keypair: { publicKey: () => SUBJECT },
    ttlLedgers: 518_400,
  };

  beforeEach(() => {
    chain.loadChainConfig.mockReturnValue(CHAIN);
    chain.credentialExpiryLedger.mockResolvedValue(9_000);
    chain.issueCredential.mockResolvedValue({ hash: "deadbeef", ledger: 500 });
  });

  function approve(requestId) {
    return request(app)
      .post("/api/issuer/approve")
      .set("x-issuer-key", ISSUER_KEY)
      .send({ requestId });
  }

  it("submits one issue_credential call per attribute and returns the hashes", async () => {
    const { body } = await submit({ attributes: ["kyc_passed", "over_18"] });
    const res = await approve(body.requestId);

    expect(res.status).toBe(200);
    expect(res.body.onChain).toBe(true);
    expect(res.body.expiresAtLedger).toBe(9_000);
    expect(res.body.transactions).toEqual([
      { attribute: "kyc_passed", hash: "deadbeef" },
      { attribute: "over_18", hash: "deadbeef" },
    ]);

    expect(chain.issueCredential).toHaveBeenCalledTimes(2);
    expect(chain.issueCredential).toHaveBeenNthCalledWith(1, CHAIN, {
      subject: SUBJECT,
      attribute: "kyc_passed",
      expiresAt: 9_000,
    });

    const credential = await request(app).get(
      `/api/kyc/credential/${body.retrievalToken}`
    );
    expect(credential.status).toBe(200);
    expect(credential.body.scheme).toBe("issuer-attested-soroban");
    expect(credential.body.verifiable).toBe(true);
    expect(credential.body.subject).toBe(SUBJECT);
    expect(credential.body.transactions).toHaveLength(2);
  });

  it("leaves the request pending and hides internals when the chain call fails", async () => {
    const { body } = await submit();
    chain.issueCredential.mockRejectedValue(new Error("host trap: secret detail"));

    const res = await approve(body.requestId);

    expect(res.status).toBe(502);
    expect(res.body.error).not.toMatch(/secret detail/);

    const status = await request(app).get(`/api/kyc/status/${body.requestId}`);
    expect(status.body.status).toBe("pending");

    // No credential was stored.
    const credential = await request(app).get(
      `/api/kyc/credential/${body.retrievalToken}`
    );
    expect(credential.status).toBe(404);
  });

  it("does not submit anything when the request is not pending", async () => {
    const { requestId } = await approvedRequest();
    chain.issueCredential.mockClear();

    const res = await approve(requestId);
    expect(res.status).toBe(409);
    expect(chain.issueCredential).not.toHaveBeenCalled();
  });
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
