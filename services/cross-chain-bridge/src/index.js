/**
 * Cross-Chain Compliance Bridge
 *
 * Relays compliance attestations from the Stellar ComplianceEngine contract to
 * an EVM AttestationReceiver with durable event queuing, explicit authenticated
 * Stellar <-> EVM identity mapping, exponential-backoff retries, and dead-letter
 * recovery.
 */

"use strict";

require("dotenv").config();
const { StellarListener } = require("./lib/stellarListener");
const { EVMRelayer } = require("./lib/evmRelayer");
const { IdentityRegistry } = require("./lib/identityRegistry");
const { EventQueue } = require("./lib/eventQueue");

class NonRetryableBridgeError extends Error {
  constructor(message) {
    super(message);
    this.name = "NonRetryableBridgeError";
    this.nonRetryable = true;
  }
}

class ComplianceBridge {
  /**
   * @param {object} options
   * @param {StellarListener} options.listener
   * @param {EVMRelayer} options.relayer
   * @param {IdentityRegistry} options.identityRegistry
   * @param {EventQueue} options.eventQueue
   * @param {number} [options.workerIntervalMs]
   */
  constructor({
    listener,
    relayer,
    identityRegistry,
    eventQueue,
    workerIntervalMs = 2_000,
  }) {
    this.listener = listener;
    this.relayer = relayer;
    this.identityRegistry = identityRegistry;
    this.eventQueue = eventQueue;
    this.workerIntervalMs = workerIntervalMs;
    this._workerTimer = null;
    this._draining = false;

    this.listener.onEventDurable = async (event) => {
      this.eventQueue.enqueue(event);
    };
  }

  async start() {
    await this.processPending();
    await this.listener.start();
    this._workerTimer = setInterval(() => {
      this.processPending().catch((err) => {
        console.error("Bridge worker error:", err.message);
      });
    }, this.workerIntervalMs);
    if (typeof this._workerTimer.unref === "function") this._workerTimer.unref();
    return this;
  }

  stop() {
    this.listener.stop();
    if (this._workerTimer) {
      clearInterval(this._workerTimer);
      this._workerTimer = null;
    }
  }

  /**
   * Process all due queued events (`pending` or due `retrying`).
   */
  async processPending(now = Date.now()) {
    if (this._draining) return [];
    this._draining = true;
    const processed = [];

    try {
      const due = this.eventQueue.getDue(now);
      for (const item of due) {
        this.eventQueue.markProcessing(item.id);
        try {
          const mapping = this.identityRegistry.resolve(item.event.subject);
          if (!mapping) {
            throw new NonRetryableBridgeError(
              `No active EVM identity mapping for Stellar subject ${item.event.subject}`
            );
          }

          const result = await this.relayer.relay({
            ...item.event,
            subject: mapping.evmAddress,
          });

          const updated = this.eventQueue.markConfirmed(item.id, {
            txHash: result.hash,
            blockNumber: result.blockNumber,
            evmSubject: mapping.evmAddress,
          });
          processed.push(updated);
        } catch (err) {
          const updated = this.eventQueue.markFailure(item.id, err.message, {
            nonRetryable: Boolean(err.nonRetryable),
          });
          processed.push(updated);
        }
      }
      return processed;
    } finally {
      this._draining = false;
    }
  }

  /**
   * Retry a dead-lettered event and immediately attempt processing.
   */
  async retryDeadLetter(eventId) {
    this.eventQueue.manualRetry(eventId);
    return this.processPending();
  }
}

async function main() {
  const complianceContractId = process.env.COMPLIANCE_CONTRACT_ID;
  if (!complianceContractId) {
    console.error("Refusing to start: COMPLIANCE_CONTRACT_ID is not set");
    process.exitCode = 1;
    return;
  }

  const relayer = new EVMRelayer({
    rpcUrl: process.env.EVM_RPC_URL,
    receiverAddress: process.env.EVM_RECEIVER_ADDRESS,
    privateKey: process.env.BRIDGE_PRIVATE_KEY,
  });

  if (!relayer.enabled) {
    console.error(
      "Refusing to start: EVM_RPC_URL, EVM_RECEIVER_ADDRESS and BRIDGE_PRIVATE_KEY are required"
    );
    process.exitCode = 1;
    return;
  }

  const identityRegistry = new IdentityRegistry({
    storeFile: process.env.IDENTITY_STORE_FILE || ".bridge-identities.json",
  });

  const eventQueue = new EventQueue({
    queueFile: process.env.QUEUE_FILE || ".bridge-queue.json",
    maxRetries: Number(process.env.BRIDGE_MAX_RETRIES || 5),
    baseDelayMs: Number(process.env.BRIDGE_RETRY_BASE_MS || 2_000),
  });

  const listener = new StellarListener({
    rpcUrl: process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
    complianceContractId,
    cursorFile: process.env.CURSOR_FILE || ".bridge-cursor.json",
  });

  listener.on("pollError", (err) => {
    console.error("Stellar poll error:", err.message);
  });

  const bridge = new ComplianceBridge({
    listener,
    relayer,
    identityRegistry,
    eventQueue,
  });

  console.log("Bridge starting — listening for Stellar attestations...");
  await bridge.start();
  return bridge;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Bridge fatal error:", err.message);
    process.exitCode = 1;
  });
}

module.exports = { main, ComplianceBridge, NonRetryableBridgeError };
