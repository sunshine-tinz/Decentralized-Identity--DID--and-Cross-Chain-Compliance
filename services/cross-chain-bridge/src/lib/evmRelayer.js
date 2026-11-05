/**
 * EVM Attestation Relayer
 *
 * Submits a signed compliance attestation to an AttestationReceiver contract on
 * an EVM chain.
 *
 * # Signing scheme (integrator contract — read this)
 * The subject is a **Stellar** identifier (`did:stellar:` controller / strkey), so
 * it is carried as a string: no Stellar address is a valid EVM address, and an
 * earlier version rejected every attestation because it required
 * `ethers.isAddress(subject)`. The destination must map the Stellar identifier to
 * whatever EVM-side account or allowlist entry it trusts.
 *
 *   digest = keccak256(abi.encode(
 *              receiver, subject, policy, compliant, ledger, nonce, chainId))
 *   signature = personal_sign(digest)
 *
 * The encoding is **non-packed**: `abi.encodePacked` with two adjacent dynamic
 * strings is ambiguous and would let a signature be re-split into a different
 * `(subject, policy)` pair. `receiver` and `chainId` bind the signature to one
 * deployment and network; `nonce` (keccak256 of the Stellar event id) lets the
 * destination reject replays.
 *
 * This matches `contracts/evm/contracts/AttestationReceiver.sol`. That contract
 * must allowlist this relayer's signer address before a relay succeeds.
 *
 * The previous implementation sent the literal bytes "stub-signature" and
 * reported reverted transactions as successes.
 */

"use strict";

const { ethers } = require("ethers");

// Interface implemented by the (not yet written) AttestationReceiver.
const RECEIVER_ABI = [
  "function receiveAttestation(string subject, string policy, bool compliant, uint256 ledger, bytes32 nonce, bytes signature) external",
  "function consumedNonce(bytes32 nonce) view returns (bool)",
];

/** Stellar account (`G...`) or contract (`C...`) strkey. */
const STELLAR_ADDRESS_RE = /^[GC][A-Z2-7]{55}$/;

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
    this.receiverAddress = receiverAddress;

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

    const { id, subject, policy, compliant, ledger } = attestation || {};
    if (!id) throw new Error("attestation.id is required");
    if (typeof subject !== "string" || !STELLAR_ADDRESS_RE.test(subject)) {
      throw new Error("attestation.subject must be a Stellar address");
    }
    if (typeof policy !== "string" || policy.length === 0) {
      throw new Error("attestation.policy is required");
    }
    if (typeof compliant !== "boolean") {
      throw new Error("attestation.compliant must be a boolean");
    }
    if (ledger === undefined || ledger === null) {
      throw new Error("attestation.ledger is required");
    }
    let ledgerValue;
    try {
      ledgerValue = BigInt(ledger);
    } catch {
      throw new Error("attestation.ledger must be an integer");
    }
    if (ledgerValue < 0n) throw new Error("attestation.ledger must not be negative");

    const receiver = this.contract.target ?? this.receiverAddress;
    if (typeof receiver !== "string" || !ethers.isAddress(receiver)) {
      throw new Error("cannot determine receiver address; refusing to sign");
    }

    // Fail closed: signing with a defaulted chain id produced a payload that is
    // either rejected downstream or replayable across chains (ACCEPTANCE-AUDIT.md M-3).
    // Ethers v6 reports `chainId` as a bigint, so it must not be checked with
    // `Number.isInteger`.
    const network = await this._resolveNetwork();
    let chainId;
    try {
      chainId = BigInt(network?.chainId);
    } catch {
      chainId = 0n;
    }
    if (chainId <= 0n) {
      throw new Error("cannot determine EVM chain id; refusing to sign an attestation");
    }

    const nonce = ethers.keccak256(ethers.toUtf8Bytes(String(id)));
    // Non-packed: see the ambiguity note in the header comment.
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "string", "string", "bool", "uint256", "bytes32", "uint256"],
        [receiver, subject, policy, compliant, ledgerValue, nonce, chainId]
      )
    );
    const signature = await this.wallet.signMessage(ethers.getBytes(digest));

    const tx = await this.contract.receiveAttestation(
      subject,
      policy,
      compliant,
      ledgerValue,
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

  /**
   * Resolve the chain id from the contract's signer, its provider, or the
   * relayer's own provider. Returns null when none is available.
   */
  async _resolveNetwork() {
    const runner = this.contract.runner;
    if (typeof runner?.getNetwork === "function") {
      try {
        const network = await runner.getNetwork();
        if (network && network.chainId !== undefined) return network;
      } catch {
        // Fall through to the provider.
      }
    }
    const provider = runner?.provider ?? this.provider;
    if (typeof provider?.getNetwork === "function") return provider.getNetwork();
    return null;
  }
}

module.exports = { EVMRelayer, RECEIVER_ABI };
