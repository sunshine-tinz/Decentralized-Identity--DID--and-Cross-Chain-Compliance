/**
 * Stellar Compliance Event Listener
 *
 * Reads Soroban contract events emitted by the ComplianceEngine contract via the
 * Soroban RPC `getEvents` endpoint, decodes them, validates every field, and
 * emits a structured attestation.
 *
 * The previous implementation polled Horizon `/effects` and, for any
 * `contract_credited` effect it saw, fabricated `{ policy: "unknown",
 * compliant: true }`. Horizon effects cannot observe Soroban contract events at
 * all, so it relayed made-up compliance data (AUDIT.md C-10). This version emits
 * nothing it has not decoded and validated.
 *
 * Expected event (published by `ComplianceEngine::export_attestation`):
 *   topics: [Symbol("compliance"), Symbol("attestation")]
 *   data:   (subject: Address, policy: Symbol, compliant: bool)
 */

"use strict";

const fs = require("fs");
const { EventEmitter } = require("events");
const { SorobanRpc, scValToNative } = require("@stellar/stellar-sdk");

const TOPIC_NAMESPACE = "compliance";
const TOPIC_ATTESTATION = "attestation";
const MAX_PROCESSED_IDS = 500;
const STELLAR_ADDRESS_RE = /^[GC][A-Z2-7]{55}$/;
const SYMBOL_RE = /^[A-Za-z0-9_]{1,32}$/;

class StellarListener extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} [options.rpcUrl]
   * @param {string} options.complianceContractId
   * @param {number} [options.pollIntervalMs]
   * @param {string} [options.cursorFile] - omit to disable persistence
   * @param {object} [options.server] - injected for tests
   */
  constructor({
    rpcUrl,
    complianceContractId,
    pollIntervalMs = 5_000,
    cursorFile = null,
    server = null,
  }) {
    super();

    if (!complianceContractId) {
      throw new Error("StellarListener: complianceContractId is required");
    }

    this.contractId = complianceContractId;
    this.pollIntervalMs = pollIntervalMs;
    this.cursorFile = cursorFile;
    this.server = server || new SorobanRpc.Server(rpcUrl);

    this._cursor = null;
    this._processedIds = [];
    this._running = false;
    this._loadState();
  }

  async start() {
    this._running = true;
    await this._poll();
    return this;
  }

  stop() {
    this._running = false;
  }

  async _poll() {
    try {
      const request = await this._requestParams();
      const response = await this.server.getEvents(request);

      for (const event of response.events || []) {
        const parsed = this._parseEvent(event);
        if (!parsed) continue;
        if (this._processedIds.includes(parsed.id)) continue;

        this._processedIds.push(parsed.id);
        if (this._processedIds.length > MAX_PROCESSED_IDS) this._processedIds.shift();
        this._cursor = event.id;

        this.emit("attestation", parsed);
      }

      if (response.cursor) this._cursor = response.cursor;
      this._saveState();
    } catch (err) {
      // Emitted under a dedicated name: emitting "error" with no listener would
      // throw and kill the process.
      this.emit("pollError", err);
    } finally {
      if (this._running) {
        this._timer = setTimeout(() => this._poll(), this.pollIntervalMs);
        if (typeof this._timer.unref === "function") this._timer.unref();
      }
    }
  }

  async _requestParams() {
    const base = {
      filters: [
        {
          type: "contract",
          contractIds: [this.contractId],
          topics: [[toScValString(TOPIC_NAMESPACE), toScValString(TOPIC_ATTESTATION)]],
        },
      ],
      limit: 50,
    };

    if (this._cursor) return { ...base, cursor: this._cursor };

    const startLedgerEnv = Number(process.env.START_LEDGER);
    if (Number.isFinite(startLedgerEnv) && startLedgerEnv > 0) {
      return { ...base, startLedger: startLedgerEnv };
    }

    const latest = await this.server.getLatestLedger();
    return { ...base, startLedger: latest.sequence };
  }

  /**
   * Decode a single RPC event. Returns null when anything is off: wrong
   * contract, wrong topic, wrong types, or an implausible value.
   * @param {object} event
   */
  _parseEvent(event) {
    if (!event || typeof event !== "object") return null;
    if (event.contractId !== this.contractId) return null;
    if (!Array.isArray(event.topic) || event.topic.length < 2) return null;
    if (!event.id) return null;

    let topics;
    let value;
    try {
      topics = event.topic.map((t) => scValToNative(t));
      value = scValToNative(event.value);
    } catch {
      return null;
    }

    if (topics[0] !== TOPIC_NAMESPACE || topics[1] !== TOPIC_ATTESTATION) return null;
    if (!Array.isArray(value) || value.length < 3) return null;

    const [subject, policy, compliant] = value;

    if (typeof subject !== "string" || !STELLAR_ADDRESS_RE.test(subject)) return null;
    if (typeof policy !== "string" || !SYMBOL_RE.test(policy)) return null;
    if (typeof compliant !== "boolean") return null;
    if (typeof event.ledger !== "number" && typeof event.ledger !== "string") return null;

    return {
      id: event.id,
      subject,
      policy,
      compliant,
      ledger: event.ledger,
      contractId: event.contractId,
    };
  }

  _loadState() {
    if (!this.cursorFile) return;
    try {
      const raw = fs.readFileSync(this.cursorFile, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.cursor === "string") this._cursor = parsed.cursor;
      if (Array.isArray(parsed.processedIds)) {
        this._processedIds = parsed.processedIds.slice(-MAX_PROCESSED_IDS);
      }
    } catch {
      // No state yet — start fresh.
    }
  }

  _saveState() {
    if (!this.cursorFile) return;
    try {
      fs.writeFileSync(
        this.cursorFile,
        JSON.stringify({ cursor: this._cursor, processedIds: this._processedIds }),
        { mode: 0o600 }
      );
    } catch (err) {
      this.emit("pollError", err);
    }
  }
}

/**
 * Build an ScVal encoding of a contract-event topic symbol. The SDK's
 * `nativeToScVal` is used lazily so this module can be required without one.
 */
function toScValString(value) {
  const { nativeToScVal } = require("@stellar/stellar-sdk");
  return nativeToScVal(value, { type: "symbol" });
}

module.exports = { StellarListener, TOPIC_NAMESPACE, TOPIC_ATTESTATION };
