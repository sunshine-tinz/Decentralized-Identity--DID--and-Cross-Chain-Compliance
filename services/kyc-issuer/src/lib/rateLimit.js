/**
 * Minimal fixed-window rate limiter.
 *
 * Deliberately dependency-free. State is per-process; a multi-instance
 * deployment must move this to shared storage.
 */

"use strict";

/**
 * @param {object} [options]
 * @param {number} [options.windowMs]
 * @param {number} [options.max]
 * @param {(req: any) => string} [options.keyFn]
 * @returns {import("express").RequestHandler}
 */
function rateLimit({ windowMs = 60_000, max = 30, keyFn } = {}) {
  /** @type {Map<string, {count: number, reset: number}>} */
  const hits = new Map();

  return function rateLimitMiddleware(req, res, next) {
    const key = keyFn ? keyFn(req) : req.ip || "unknown";
    const now = Date.now();

    // Bound memory growth from spoofed keys.
    if (hits.size > 10_000) {
      for (const [k, v] of hits) {
        if (now > v.reset) hits.delete(k);
      }
    }

    const record = hits.get(key);
    if (!record || now > record.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }

    record.count += 1;
    if (record.count > max) {
      const retryAfter = Math.ceil((record.reset - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Too many requests" });
    }

    return next();
  };
}

module.exports = { rateLimit };
