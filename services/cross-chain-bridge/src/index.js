/**
 * Cross-Chain Compliance Bridge
 *
 * Relays compliance attestations from the Stellar ComplianceEngine contract to
 * an EVM AttestationReceiver.
 *
 * Flow:
 *  1. Read `compliance.attestation` events from Soroban RPC
 *  2. Decode and validate every field; drop anything malformed
 *  3. Deduplicate by event id, and advance the persisted cursor only once the
 *     relay for that event has been confirmed
 *  4. Sign and submit to the EVM receiver, verifying the receipt status
 *
 * This service refuses to start unless it can actually verify its input and
 * submit a signed payload. It previously started with missing configuration and
 * logged "Relayed to EVM: null". The destination contract does not exist in this
 * repository yet, so end-to-end relay is untested (AUDIT.md H-9).
 */

"use strict";

require("dotenv").config();
const { StellarListener } = require("./lib/stellarListener");
const { EVMRelayer } = require("./lib/evmRelayer");

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

  const listener = new StellarListener({
    rpcUrl: process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
    complianceContractId,
    cursorFile: process.env.CURSOR_FILE || ".bridge-cursor.json",
  });

  listener.on("attestation", async (attestation) => {
    // Throwing is how the listener is told delivery was not confirmed: it leaves the
    // event unprocessed and retries it on the next poll. Catching here would silently
    // drop the attestation (ACCEPTANCE-AUDIT.md H-2).
    //
    // Delivery is at-least-once: a poll that cannot relay stops at the failed event
    // and retries it until it succeeds, so a permanently failing event blocks the
    // events behind it (head-of-line). An operator sees it via "pollError".
    const txHash = await relayer.relay(attestation);
    console.log(`Relayed attestation ${attestation.id} to EVM: ${txHash}`);
  });

  listener.on("pollError", (err) => {
    console.error("Stellar poll error:", err.message);
  });

  console.log("Bridge starting — listening for Stellar attestations...");
  await listener.start();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Bridge fatal error:", err.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
