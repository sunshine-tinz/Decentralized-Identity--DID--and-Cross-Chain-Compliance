/**
 * EVM Attestation Relayer
 *
 * Submits a signed compliance attestation to an AttestationReceiver contract on
 * an EVM chain.
 *
 * # Signing scheme (integrator contract — read this)
 * The relayer signs an EIP-191 prefixed digest:
 *
 *   digest = keccak256(abi.encodePacked(
 *              subject, policy, compliant, nonce, chainId))
 *   signature = personal_sign(digest)
 *
 * `nonce` is the unique Stellar event id (keccak256 of it), so a destination
 * contract can reject replays by tracking consumed nonces. The destination MUST
 * verify the signature against an allowlisted relayer and MUST store the nonce.
 * See `contracts/evm/AttestationReceiver.sol`.
 */

"use strict";

const { ethers } = require("ethers");

// Interface implemented by AttestationReceiver (contracts/evm/AttestationReceiver.sol).
const RECEIVER_ABI = [
  "function receiveAttestation(address subject, string policy, bool compliant, bytes32 nonce, bytes signature) external",
  "function consumedNonce(bytes32 nonce) view returns (bool)",
  "function isCompliant(address subject, string policy) view returns (bool)",
];

class EVMRelayer {
  /**
   * @param {object} options
   * @param {string} [options.rpcUrl]
   * @param {string} [options.receiverAddress]
   * @param {string} [options.privateKey]
   * @param {object} [options.contract] - injected for tests
   * @param {object} [options.wallet] - injected for tests
   */
  constructor({ rpcUrl, receiverAddress, privateKey, contract, wallet } = {}) {
    this.enabled = false;

    if (contract && wallet) {
      this.contract = contract;
      this.wallet = wallet;
      this.enabled = true;
      return;
    }

    if (!rpcUrl || !receiverAddress || !privateKey) {
      // Fail closed: callers must check `enabled` and must not silently treat a
      // disabled relayer as success.
      return;
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.contract = new ethers.Contract(receiverAddress, RECEIVER_ABI, this.wallet);
    this.enabled = true;
  }

  /**
   * Relay one attestation.
   *
   * @param {object} attestation - { id, subject, policy, compliant, ledger }
   * @returns {Promise<string>} transaction hash of a confirmed, successful tx
   * @throws when unconfigured, malformed, or the transaction reverts
   */
  async relay(attestation) {
    if (!this.enabled) {
      throw new Error("EVM relayer is not configured");
    }

    const { id, subject, policy, compliant } = attestation || {};
    if (!id) throw new Error("attestation.id is required");
    if (typeof subject !== "string" || !ethers.isAddress(subject)) {
      throw new Error("attestation.subject must be a valid EVM address");
    }
    if (typeof policy !== "string" || policy.length === 0) {
      throw new Error("attestation.policy is required");
    }
    if (typeof compliant !== "boolean") {
      throw new Error("attestation.compliant must be a boolean");
    }

    const network = await this.contract.runner?.provider?.getNetwork?.();
    const chainId = network?.chainId ?? 0;
    const targetAddress = typeof this.contract.getAddress === "function"
      ? await this.contract.getAddress()
      : (this.contract.target || ethers.ZeroAddress);

    const nonce = ethers.keccak256(ethers.toUtf8Bytes(String(id)));
    const digest = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [subject, policy, compliant, nonce, chainId, targetAddress]
    );
    const signature = await this.wallet.signMessage(ethers.getBytes(digest));

    const tx = await this.contract.receiveAttestation(
      subject,
      policy,
      compliant,
      nonce,
      signature
    );

    const receipt = await tx.wait();
    // ethers resolves `wait()` for reverted transactions; a status of 0 must not
    // be reported as a successful relay.
    if (!receipt || receipt.status !== 1) {
      throw new Error(
        `attestation transaction reverted (tx ${tx.hash}, status ${receipt && receipt.status})`
      );
    }

    return tx.hash;
  }
}

module.exports = { EVMRelayer, RECEIVER_ABI };
