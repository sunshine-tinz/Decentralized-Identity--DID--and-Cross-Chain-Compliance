"use strict";

const request = require("supertest");
const app = require("../src/index");
const store = require("../src/store");

beforeEach(() => {
  store.kycRequests.clear();
  store.issuedCredentials.clear();
});

describe("POST /api/kyc/request", () => {
  it("creates a pending request and returns requestId", async () => {
    const res = await request(app).post("/api/kyc/request").send({
      userId: "user-1",
      issuerPubkey: "a".repeat(192),
      attributes: ["kyc_passed"],
      personalInfo: { name: "Alice" },
    });
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeDefined();
    expect(store.kycRequests.size).toBe(1);
  });

  it("rejects missing fields", async () => {
    const res = await request(app).post("/api/kyc/request").send({ userId: "u1" });
    expect(res.status).toBe(400);
  });

  it("rejects empty attributes array", async () => {
    const res = await request(app).post("/api/kyc/request").send({
      userId: "u1",
      issuerPubkey: "a".repeat(192),
      attributes: [],
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/kyc/status/:requestId", () => {
  it("returns pending status for a new request", async () => {
    const post = await request(app).post("/api/kyc/request").send({
      userId: "user-2",
      issuerPubkey: "b".repeat(192),
      attributes: ["kyc_passed"],
    });
    const { requestId } = post.body;

    const res = await request(app).get(`/api/kyc/status/${requestId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
  });

  it("returns 404 for unknown requestId", async () => {
    const res = await request(app).get("/api/kyc/status/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/kyc/credential/:userId", () => {
  it("returns credential and deletes it (one-time retrieval)", async () => {
    store.issuedCredentials.set("user-3", { issuerPubkey: "x", attributeKeys: {} });

    const first = await request(app).get("/api/kyc/credential/user-3");
    expect(first.status).toBe(200);
    expect(first.body.issuerPubkey).toBe("x");

    const second = await request(app).get("/api/kyc/credential/user-3");
    expect(second.status).toBe(404);
  });
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
