/**
 * Authenticated Stellar <-> EVM Identity Mapping Registry
 *
 * Maps a Stellar Ed25519 subject address (G...) to an EVM address (0x...) only
 * when ownership of BOTH addresses is cryptographically proven via dual
 * signatures over a versioned canonical binding message.
 *
 * Trust assumptions:
 *  - Stellar ownership is verified using Ed25519 (`StrKey` + `Keypair.verify`).
 *  - EVM ownership is verified using EIP-191 (`ethers.verifyMessage`).
 *  - Version numbers are strictly monotonic per Stellar address so old signed
 *    registrations cannot be replayed to revert a rotation or revocation.
 *  - Never derives or truncates a Stellar address into an EVM address.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { Keypair, StrKey } = require("@stellar/stellar-sdk");
const { ethers } = require("ethers");

function buildLinkMessage({ stellarAddress, evmAddress, version }) {
  return `Stellar-EVM-Identity-Link-v1:${stellarAddress}:${evmAddress.toLowerCase()}:v${version}`;
}

function buildRevokeMessage({ stellarAddress, version }) {
  return `Stellar-EVM-Identity-Revoke-v1:${stellarAddress}:v${version}`;
}

function decodeStellarSignature(signature) {
  if (Buffer.isBuffer(signature)) return signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("stellarSignature must be a non-empty string");
  }
  const trimmed = signature.trim();
  if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  return Buffer.from(trimmed, "base64");
}

class IdentityRegistry {
  /**
   * @param {object} [options]
   * @param {string|null} [options.storeFile] - Path for durable JSON persistence
   */
  constructor({ storeFile = null } = {}) {
    this.storeFile = storeFile;
    /** @type {Map<string, {stellarAddress: string, evmAddress: string, version: number, active: boolean, updatedAt: number}>} */
    this._mappings = new Map();
    this._load();
  }

  /**
   * Register or rotate a Stellar <-> EVM mapping after verifying dual signatures.
   */
  registerMapping({ stellarAddress, evmAddress, version, stellarSignature, evmSignature }) {
    if (typeof stellarAddress !== "string" || !StrKey.isValidEd25519PublicKey(stellarAddress)) {
      throw new Error("Invalid Stellar subject address");
    }
    if (typeof evmAddress !== "string" || !ethers.isAddress(evmAddress)) {
      throw new Error("Invalid EVM address");
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("Mapping version must be a positive integer");
    }

    const existing = this._mappings.get(stellarAddress);
    if (existing && version <= existing.version) {
      throw new Error(
        `Stale mapping version ${version}; must be greater than current version ${existing.version}`
      );
    }

    const normalizedEvm = ethers.getAddress(evmAddress);
    const message = buildLinkMessage({
      stellarAddress,
      evmAddress: normalizedEvm,
      version,
    });

    const sigBuf = decodeStellarSignature(stellarSignature);
    const stellarOk = Keypair.fromPublicKey(stellarAddress).verify(
      Buffer.from(message, "utf8"),
      sigBuf
    );
    if (!stellarOk) {
      throw new Error("Invalid Stellar ownership signature");
    }

    let recoveredEvm;
    try {
      recoveredEvm = ethers.verifyMessage(message, evmSignature);
    } catch {
      throw new Error("Invalid EVM ownership signature");
    }
    if (recoveredEvm.toLowerCase() !== normalizedEvm.toLowerCase()) {
      throw new Error("EVM signature does not match target EVM address");
    }

    const record = {
      stellarAddress,
      evmAddress: normalizedEvm,
      version,
      active: true,
      updatedAt: Date.now(),
    };
    this._mappings.set(stellarAddress, record);
    this._save();
    return { ...record };
  }

  /**
   * Revoke a mapping, authorized by the Stellar identity controller.
   */
  revokeMapping({ stellarAddress, version, stellarSignature }) {
    if (typeof stellarAddress !== "string" || !StrKey.isValidEd25519PublicKey(stellarAddress)) {
      throw new Error("Invalid Stellar subject address");
    }
    const existing = this._mappings.get(stellarAddress);
    if (!existing) {
      throw new Error("Identity mapping not found");
    }
    if (!Number.isInteger(version) || version < existing.version) {
      throw new Error(`Revocation version ${version} is older than ${existing.version}`);
    }

    const message = buildRevokeMessage({ stellarAddress, version });
    const sigBuf = decodeStellarSignature(stellarSignature);
    const stellarOk = Keypair.fromPublicKey(stellarAddress).verify(
      Buffer.from(message, "utf8"),
      sigBuf
    );
    if (!stellarOk) {
      throw new Error("Invalid Stellar revocation signature");
    }

    const updated = {
      ...existing,
      version,
      active: false,
      updatedAt: Date.now(),
    };
    this._mappings.set(stellarAddress, updated);
    this._save();
    return { ...updated };
  }

  /**
   * Resolve an active EVM address for a Stellar subject, or null if unmapped/revoked.
   * @param {string} stellarAddress
   */
  resolve(stellarAddress) {
    const entry = this._mappings.get(stellarAddress);
    if (!entry || !entry.active) return null;
    return { ...entry };
  }

  _load() {
    if (!this.storeFile) return;
    try {
      const raw = fs.readFileSync(this.storeFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.mappings)) {
        for (const item of parsed.mappings) {
          if (item && typeof item.stellarAddress === "string") {
            this._mappings.set(item.stellarAddress, item);
          }
        }
      }
    } catch {
      // Fresh registry
    }
  }

  _save() {
    if (!this.storeFile) return;
    const dir = path.dirname(this.storeFile);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.storeFile}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ mappings: [...this._mappings.values()] }, null, 2),
      { mode: 0o600 }
    );
    fs.renameSync(tmp, this.storeFile);
  }
}

module.exports = {
  IdentityRegistry,
  buildLinkMessage,
  buildRevokeMessage,
};
