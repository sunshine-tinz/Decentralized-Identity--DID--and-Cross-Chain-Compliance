/**
 * EVM Attestation Relayer
 *
 * Submits EIP-712 signed compliance attestations to an AttestationReceiver
 * contract on an EVM chain.
 *
 * EIP-712 Domain:
 *   name: "StellarComplianceBridge"
 *   version: "1"
 *   chainId: <destination chainId>
 *   verifyingContract: <AttestationReceiver address>
 *
 * Attestation struct:
 *   (address subject, string policy, bool compliant, uint64 stellarLedger, uint64 expiresAt, bytes32 nonce)
 */

"use strict";

const { ethers } = require("ethers");

const RECEIVER_ABI = [
  "function receiveAttestation(address subject, string policy, bool compliant, uint64 stellarLedger, uint64 expiresAt, bytes32 nonce, bytes signature) external",
  "function revokeAttestation(address subject, string policy, uint64 stellarLedger) external",
  "function consumedNonce(bytes32 nonce) view returns (bool)",
  "function isCompliant(address subject, string policy) view returns (bool)",
  "function authorizedRelayers(address relayer) view returns (bool)",
];

const EIP712_DOMAIN_NAME = "StellarComplianceBridge";
const EIP712_DOMAIN_VERSION = "1";
const ATTESTATION_TYPES = {
  Attestation: [
    { name: "subject", type: "address" },
    { name: "policy", type: "string" },
    { name: "compliant", type: "bool" },
    { name: "stellarLedger", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
};

const DEFAULT_ATTESTATION_TTL_SECONDS = 30 * 24 * 60 * 60;

class EVMRelayer {
  /**
   * @param {object} options
   * @param {string} [options.rpcUrl]
   * @param {string} [options.receiverAddress]
   * @param {string} [options.privateKey]
   * @param {number} [options.defaultTtlSeconds]
   * @param {object} [options.contract] - injected for tests
   * @param {object} [options.wallet] - injected for tests
   */
  constructor({
    rpcUrl,
    receiverAddress,
    privateKey,
    defaultTtlSeconds = DEFAULT_ATTESTATION_TTL_SECONDS,
    contract,
    wallet,
  } = {}) {
    this.enabled = false;
    this.defaultTtlSeconds = defaultTtlSeconds;

    if (contract && wallet) {
      this.contract = contract;
      this.wallet = wallet;
      this.enabled = true;
      return;
    }

    if (!rpcUrl || !receiverAddress || !privateKey) {
      return;
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.contract = new ethers.Contract(receiverAddress, RECEIVER_ABI, this.wallet);
    this.enabled = true;
  }

  /**
   * Relay one attestation with an explicit EVM `subject`.
   *
   * @param {object} attestation - { id, subject (EVM 0x...), policy, compliant, ledger, expiresAt? }
   * @returns {Promise<{hash: string, blockNumber: number|null, alreadyConfirmed?: boolean}>}
   */
  async relay(attestation) {
    if (!this.enabled) {
      throw new Error("EVM relayer is not configured");
    }

    const { id, subject, policy, compliant, ledger, expiresAt } = attestation || {};
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
    const stellarLedger = Number(ledger);
    if (!Number.isInteger(stellarLedger) || stellarLedger <= 0) {
      throw new Error("attestation.ledger must be a positive integer");
    }

    const effectiveExpiresAt =
      Number.isInteger(expiresAt) && expiresAt > 0
        ? expiresAt
        : Math.floor(Date.now() / 1000) + this.defaultTtlSeconds;

    const nonce = ethers.keccak256(ethers.toUtf8Bytes(String(id)));

    // Idempotency check across process restarts.
    if (typeof this.contract.consumedNonce === "function") {
      const alreadyConsumed = await this.contract.consumedNonce(nonce);
      if (alreadyConsumed) {
        return { hash: "already-consumed", blockNumber: null, alreadyConfirmed: true };
      }
    }

    const network = await this.contract.runner?.provider?.getNetwork?.();
    const chainId = network?.chainId ?? 0n;
    const verifyingContract =
      typeof this.contract.getAddress === "function"
        ? await this.contract.getAddress()
        : this.contract.target || ethers.ZeroAddress;

    const domain = {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: BigInt(chainId),
      verifyingContract,
    };

    const message = {
      subject: ethers.getAddress(subject),
      policy,
      compliant,
      stellarLedger: BigInt(stellarLedger),
      expiresAt: BigInt(effectiveExpiresAt),
      nonce,
    };

    const signature = await this.wallet.signTypedData(domain, ATTESTATION_TYPES, message);

    const tx = await this.contract.receiveAttestation(
      message.subject,
      message.policy,
      message.compliant,
      message.stellarLedger,
      message.expiresAt,
      message.nonce,
      signature
    );

    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(
        `attestation transaction reverted (tx ${tx.hash}, status ${receipt && receipt.status})`
      );
    }

    return {
      hash: tx.hash,
      blockNumber: receipt.blockNumber ?? null,
    };
  }
}

module.exports = {
  EVMRelayer,
  RECEIVER_ABI,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  ATTESTATION_TYPES,
};
