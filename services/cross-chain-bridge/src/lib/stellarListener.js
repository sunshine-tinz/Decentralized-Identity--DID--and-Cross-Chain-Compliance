/**
 * Stellar Compliance Event Listener
 *
 * Polls Horizon for contract events emitted by the ComplianceEngine contract.
 *
 * TODO for contributors:
 *  - Switch from polling to Horizon SSE streaming (/accounts/:id/effects)
 *  - Parse Soroban contract events (XDR) into structured attestation objects
 *  - Add cursor persistence so the bridge survives restarts without re-processing
 */

"use strict";

const { EventEmitter } = require("events");
const { Horizon } = require("@stellar/stellar-sdk");

class StellarListener extends EventEmitter {
  constructor({ horizonUrl, complianceContractId }) {
    super();
    this.server = new Horizon.Server(horizonUrl);
    this.contractId = complianceContractId;
    this.pollIntervalMs = 5000;
    this._cursor = "now";
  }

  async start() {
    console.log(`Listening on Stellar contract: ${this.contractId}`);
    this._poll();
  }

  async _poll() {
    try {
      // TODO: replace with Soroban event streaming once SDK supports it
      // For now, fetch recent ledger effects and filter by contract
      const effects = await this.server
        .effects()
        .cursor(this._cursor)
        .limit(50)
        .call();

      for (const effect of effects.records) {
        // TODO: parse XDR contract events for "export_attestation" calls
        if (effect.type === "contract_credited") {
          this.emit("attestation", this._parseAttestation(effect));
          this._cursor = effect.paging_token;
        }
      }
    } catch (err) {
      console.error("Stellar poll error:", err.message);
    }

    setTimeout(() => this._poll(), this.pollIntervalMs);
  }

  /** TODO: implement real XDR parsing */
  _parseAttestation(effect) {
    return {
      subject: effect.account,
      policy: "unknown",
      compliant: true,
      ledger: effect.created_at,
    };
  }
}

module.exports = { StellarListener };
