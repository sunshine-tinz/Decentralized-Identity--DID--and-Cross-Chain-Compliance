/**
 * EVM Attestation Relayer
 *
 * Submits compliance attestations to the AttestationReceiver contract on EVM chains.
 *
 * TODO for contributors:
 *  - Deploy AttestationReceiver.sol (see contracts/evm/ — to be created)
 *  - Add signature verification: EVM contract should verify the Stellar-signed payload
 *  - Support multiple chains via a chain registry config
 *  - Add gas estimation and dynamic fee management
 */

"use strict";

const { ethers } = require("ethers");

// Minimal ABI for the EVM receiver contract
// TODO: replace with full ABI once AttestationReceiver.sol is implemented
const RECEIVER_ABI = [
  "function receiveAttestation(address subject, string policy, bool compliant, bytes signature) external",
];

class EVMRelayer {
  constructor({ rpcUrl, receiverAddress, privateKey }) {
    if (!rpcUrl || !receiverAddress || !privateKey) {
      console.warn("EVMRelayer: missing config — relay calls will be no-ops");
      this.enabled = false;
      return;
    }
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.receiver = new ethers.Contract(receiverAddress, RECEIVER_ABI, this.wallet);
    this.enabled = true;
  }

  /**
   * Relay a compliance attestation to the EVM chain.
   *
   * @param {object} attestation - { subject, policy, compliant, ledger }
   * @returns {string} EVM transaction hash
   */
  async relay(attestation) {
    if (!this.enabled) {
      console.log("[EVMRelayer] disabled — skipping relay");
      return null;
    }

    const { subject, policy, compliant } = attestation;

    // TODO: produce a real Stellar-signed payload for the EVM contract to verify
    const signature = ethers.toUtf8Bytes("stub-signature");

    const tx = await this.receiver.receiveAttestation(subject, policy, compliant, signature);
    await tx.wait();
    return tx.hash;
  }
}

module.exports = { EVMRelayer };
