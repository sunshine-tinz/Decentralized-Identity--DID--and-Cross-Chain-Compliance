/**
 * Cross-Chain Compliance Bridge
 *
 * Listens for compliance attestation events on Stellar and relays them
 * to EVM chains (Ethereum, Polygon, etc.) so users don't need to re-KYC
 * on every chain — inspired by Chainlink CCIP's cross-chain identity model
 * and KILT Protocol's Decentralized Identity Provider (DIP).
 *
 * Flow:
 *  1. Poll Stellar for ComplianceEngine "export_attestation" events
 *  2. Verify the attestation payload (signed by the Stellar compliance contract)
 *  3. Submit a transaction to the EVM AttestationReceiver contract
 *
 * TODO for contributors:
 *  - Replace polling with Stellar event streaming (horizon /effects endpoint)
 *  - Add signature verification before relaying (prevent spoofed attestations)
 *  - Support multiple destination chains via config
 *  - Add retry logic with exponential backoff for failed EVM submissions
 *  - Implement a nonce / replay-protection mechanism on the EVM side
 */

"use strict";

require("dotenv").config();
const { StellarListener } = require("./lib/stellarListener");
const { EVMRelayer } = require("./lib/evmRelayer");

async function main() {
  const listener = new StellarListener({
    horizonUrl: process.env.HORIZON_URL || "https://horizon-testnet.stellar.org",
    complianceContractId: process.env.COMPLIANCE_CONTRACT_ID,
  });

  const relayer = new EVMRelayer({
    rpcUrl: process.env.EVM_RPC_URL,
    receiverAddress: process.env.EVM_RECEIVER_ADDRESS,
    privateKey: process.env.BRIDGE_PRIVATE_KEY,
  });

  console.log("Bridge starting — listening for Stellar attestations...");

  listener.on("attestation", async (attestation) => {
    console.log("Relaying attestation:", attestation);
    try {
      const txHash = await relayer.relay(attestation);
      console.log("Relayed to EVM:", txHash);
    } catch (err) {
      console.error("Relay failed:", err.message);
      // TODO: add to retry queue
    }
  });

  await listener.start();
}

main().catch(console.error);
