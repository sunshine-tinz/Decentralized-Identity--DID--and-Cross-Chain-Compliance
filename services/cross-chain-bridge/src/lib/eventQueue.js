/**
 * Durable Event Queue for Cross-Chain Attestation Relay
 *
 * Tracks observed Stellar events through explicit lifecycle states:
 *   pending -> processing -> confirmed
 *                         -> retrying -> processing (exponential backoff)
 *                         -> failed (dead-letter after maxRetries or non-retryable error)
 *
 * On restart, any record stuck in `processing` is recovered back to `pending`
 * so mid-flight crashes never drop events.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const STATES = {
  PENDING: "pending",
  PROCESSING: "processing",
  RETRYING: "retrying",
  CONFIRMED: "confirmed",
  FAILED: "failed",
};

class EventQueue {
  /**
   * @param {object} [options]
   * @param {string|null} [options.queueFile]
   * @param {number} [options.maxRetries]
   * @param {number} [options.baseDelayMs]
   */
  constructor({ queueFile = null, maxRetries = 5, baseDelayMs = 2_000 } = {}) {
    this.queueFile = queueFile;
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    /** @type {Map<string, object>} */
    this._items = new Map();
    this._load();
  }

  /**
   * Durably record a newly observed Stellar event. Deduplicates by `event.id`.
   */
  enqueue(event) {
    if (!event || !event.id) {
      throw new Error("EventQueue.enqueue: event.id is required");
    }

    const existing = this._items.get(event.id);
    if (existing) {
      return { inserted: false, record: { ...existing } };
    }

    const now = Date.now();
    const record = {
      id: event.id,
      event,
      state: STATES.PENDING,
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      txHash: null,
      blockNumber: null,
      evmSubject: null,
      createdAt: now,
      updatedAt: now,
    };
    this._items.set(event.id, record);
    this._save();
    return { inserted: true, record: { ...record } };
  }

  /**
   * Return records ready for processing (`pending` or due `retrying`).
   */
  getDue(now = Date.now()) {
    const due = [];
    for (const item of this._items.values()) {
      if (
        item.state === STATES.PENDING ||
        (item.state === STATES.RETRYING && item.nextAttemptAt <= now)
      ) {
        due.push({ ...item });
      }
    }
    return due;
  }

  get(id) {
    const item = this._items.get(id);
    return item ? { ...item } : null;
  }

  listByState(state) {
    return [...this._items.values()]
      .filter((item) => item.state === state)
      .map((item) => ({ ...item }));
  }

  markProcessing(id) {
    const item = this._requireItem(id);
    item.state = STATES.PROCESSING;
    item.updatedAt = Date.now();
    this._save();
    return { ...item };
  }

  markConfirmed(id, { txHash, blockNumber = null, evmSubject = null } = {}) {
    const item = this._requireItem(id);
    item.state = STATES.CONFIRMED;
    item.txHash = txHash || item.txHash;
    item.blockNumber = blockNumber;
    item.evmSubject = evmSubject || item.evmSubject;
    item.lastError = null;
    item.updatedAt = Date.now();
    this._save();
    return { ...item };
  }

  /**
   * Schedule an exponential-backoff retry or transition to dead-letter `failed`.
   */
  markFailure(id, errorMessage, { nonRetryable = false, now = Date.now() } = {}) {
    const item = this._requireItem(id);
    item.attempts += 1;
    item.lastError = String(errorMessage || "Unknown error");
    item.updatedAt = now;

    if (nonRetryable || item.attempts >= this.maxRetries) {
      item.state = STATES.FAILED;
      item.nextAttemptAt = null;
    } else {
      const delay = this.baseDelayMs * Math.pow(2, item.attempts - 1);
      item.state = STATES.RETRYING;
      item.nextAttemptAt = now + delay;
    }

    this._save();
    return { ...item };
  }

  /**
   * Reset a dead-letter (`failed`) event back to `pending` for manual retry.
   */
  manualRetry(id) {
    const item = this._requireItem(id);
    if (item.state !== STATES.FAILED) {
      throw new Error(`Event ${id} is in state ${item.state}, expected failed`);
    }
    item.state = STATES.PENDING;
    item.attempts = 0;
    item.nextAttemptAt = Date.now();
    item.lastError = null;
    item.updatedAt = Date.now();
    this._save();
    return { ...item };
  }

  _requireItem(id) {
    const item = this._items.get(id);
    if (!item) throw new Error(`Unknown queued event ${id}`);
    return item;
  }

  _load() {
    if (!this.queueFile) return;
    try {
      const raw = fs.readFileSync(this.queueFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.items)) {
        let recovered = false;
        for (const item of parsed.items) {
          if (!item || typeof item.id !== "string") continue;
          // Crash recovery: re-queue mid-flight processing entries.
          if (item.state === STATES.PROCESSING) {
            item.state = STATES.PENDING;
            item.nextAttemptAt = Date.now();
            recovered = true;
          }
          this._items.set(item.id, item);
        }
        if (recovered) this._save();
      }
    } catch {
      // Fresh queue
    }
  }

  _save() {
    if (!this.queueFile) return;
    const dir = path.dirname(this.queueFile);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.queueFile}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ items: [...this._items.values()] }, null, 2),
      { mode: 0o600 }
    );
    fs.renameSync(tmp, this.queueFile);
  }
}

module.exports = { EventQueue, STATES };
