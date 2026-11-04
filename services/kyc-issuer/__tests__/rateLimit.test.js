"use strict";

const { rateLimit } = require("../src/lib/rateLimit");

function fakeReq(ip = "127.0.0.1") {
  return { ip };
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("rateLimit", () => {
  it("allows requests up to the limit and rejects beyond it", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2 });
    let allowed = 0;
    const next = () => {
      allowed += 1;
    };

    limiter(fakeReq(), fakeRes(), next);
    limiter(fakeReq(), fakeRes(), next);
    expect(allowed).toBe(2);

    const res = fakeRes();
    limiter(fakeReq(), res, next);
    expect(allowed).toBe(2);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "Too many requests" });
    expect(res.headers["Retry-After"]).toBeDefined();
  });

  it("counts keys independently", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyFn: (req) => req.ip });
    let allowed = 0;
    const next = () => {
      allowed += 1;
    };

    limiter(fakeReq("1.1.1.1"), fakeRes(), next);
    limiter(fakeReq("2.2.2.2"), fakeRes(), next);
    expect(allowed).toBe(2);

    const res = fakeRes();
    limiter(fakeReq("1.1.1.1"), res, next);
    expect(res.statusCode).toBe(429);
  });

  it("resets after the window elapses", async () => {
    const limiter = rateLimit({ windowMs: 5, max: 1 });
    let allowed = 0;
    const next = () => {
      allowed += 1;
    };

    limiter(fakeReq(), fakeRes(), next);
    limiter(fakeReq(), fakeRes(), next);
    expect(allowed).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 10));

    limiter(fakeReq(), fakeRes(), next);
    expect(allowed).toBe(2);
  });
});
