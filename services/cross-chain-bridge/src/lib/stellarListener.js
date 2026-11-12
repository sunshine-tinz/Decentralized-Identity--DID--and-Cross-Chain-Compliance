/**
 * Stellar Compliance Event Listener
 *
 * Reads Soroban contract events emitted by the ComplianceEngine contract via the
 * Soroban RPC `getEvents` endpoint, decodes them, validates every field, and
 * durably records them before advancing the persisted cursor.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { rpc, scValToNative } = require("@stellar/stellar-sdk");

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
   * @param {string|null} [options.cursorFile] - omit to disable persistence
   * @param {object|null} [options.server] - injected for tests
   * @param {(event: object) => Promise<void>|void} [options.onEventDurable]
   */
  constructor({
    rpcUrl,
    complianceContractId,
    pollIntervalMs = 5_000,
    cursorFile = null,
    server = null,
    onEventDurable = null,
  }) {
    super();

    if (!complianceContractId) {
      throw new Error("StellarListener: complianceContractId is required");
    }

    this.contractId = complianceContractId;
    this.pollIntervalMs = pollIntervalMs;
    this.cursorFile = cursorFile;
    this.server = server || new rpc.Server(rpcUrl);
    this.onEventDurable = onEventDurable;

    this._cursor = null;
    this._processedIds = [];
    this._running = false;
    this._timer = null;
    this._loadState();
  }

  async start() {
    this._running = true;
    await this._poll();
    return this;
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  async _poll() {
    try {
      const request = await this._requestParams();
      const response = await this.server.getEvents(request);

      for (const event of response.events || []) {
        const parsed = this._parseEvent(event);
        if (!parsed) continue;
        if (this._processedIds.includes(parsed.id)) continue;

        // Only advance cursor / processed list after durable recording succeeds.
        if (typeof this.onEventDurable === "function") {
          await this.onEventDurable(parsed);
        }

        this._processedIds.push(parsed.id);
        if (this._processedIds.length > MAX_PROCESSED_IDS) this._processedIds.shift();
        this._cursor = event.id;
        this._saveState();

        this.emit("attestation", parsed);
      }

      if (response.cursor) {
        this._cursor = response.cursor;
        this._saveState();
      }
    } catch (err) {
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
          topics: [
            [
              toScValString(TOPIC_NAMESPACE).toXDR("base64"),
              toScValString(TOPIC_ATTESTATION).toXDR("base64"),
            ],
          ],
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
    const eventContractId =
      typeof event.contractId === "string"
        ? event.contractId
        : event.contractId?.contractId?.() || event.contractId?.toString?.();
    if (eventContractId !== this.contractId) return null;
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

    const ledger = Number(event.ledger);
    if (!Number.isInteger(ledger) || ledger <= 0) return null;

    return {
      id: String(event.id),
      subject,
      policy,
      compliant,
      ledger,
      contractId: eventContractId,
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
      fs.mkdirSync(path.dirname(this.cursorFile), { recursive: true });
      const tmp = `${this.cursorFile}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({ cursor: this._cursor, processedIds: this._processedIds }),
        { mode: 0o600 }
      );
      fs.renameSync(tmp, this.cursorFile);
    } catch (err) {
      this.emit("pollError", err);
    }
  }
}

function toScValString(value) {
  const { nativeToScVal } = require("@stellar/stellar-sdk");
  return nativeToScVal(value, { type: "symbol" });
}

module.exports = { StellarListener, TOPIC_NAMESPACE, TOPIC_ATTESTATION };
