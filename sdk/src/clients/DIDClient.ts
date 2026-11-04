/**
 * DIDClient — interact with the DID Registry Soroban contract.
 *
 * Reads are simulated against Soroban RPC. Writes are assembled and prepared,
 * then returned as unsigned XDR for the caller to sign — the SDK never holds a
 * secret key.
 */

import { Address } from "@stellar/stellar-sdk";
import { DIDDocument, StellarDIDConfig } from "../types";
import {
  buildPreparedTransaction,
  bytesArg,
  simulateRead,
  toHex,
} from "../lib/soroban";

export class DIDClient {
  private config: StellarDIDConfig;

  constructor(config: StellarDIDConfig) {
    this.config = config;
  }

  /**
   * Register a new DID for the given controller address.
   *
   * @param controllerAddress - Stellar address (G...)
   * @param documentHash      - hex-encoded content hash of the off-chain DID document
   * @returns unsigned, prepared transaction XDR
   */
  async register(controllerAddress: string, documentHash: string): Promise<string> {
    return buildPreparedTransaction(this.config, this.config.didRegistryId, "register", [
      Address.fromString(controllerAddress).toScVal(),
      bytesArg(documentHash, "documentHash"),
    ]);
  }

  /**
   * Replace the anchored document hash for an existing DID.
   *
   * @returns unsigned, prepared transaction XDR
   */
  async update(controllerAddress: string, newDocumentHash: string): Promise<string> {
    return buildPreparedTransaction(this.config, this.config.didRegistryId, "update", [
      Address.fromString(controllerAddress).toScVal(),
      bytesArg(newDocumentHash, "newDocumentHash"),
    ]);
  }

  /**
   * Deactivate a DID. Irreversible.
   *
   * @returns unsigned, prepared transaction XDR
   */
  async deactivate(controllerAddress: string): Promise<string> {
    return buildPreparedTransaction(
      this.config,
      this.config.didRegistryId,
      "deactivate",
      [Address.fromString(controllerAddress).toScVal()]
    );
  }

  /**
   * Resolve a DID document by controller address.
   */
  async resolve(controllerAddress: string): Promise<DIDDocument> {
    const raw = (await simulateRead(this.config, this.config.didRegistryId, "resolve", [
      Address.fromString(controllerAddress).toScVal(),
    ])) as {
      id: string;
      document_hash: unknown;
      updated_at: number;
      active: boolean;
    };

    return {
      id: raw.id,
      documentHash: toHex(raw.document_hash),
      updatedAt: Number(raw.updated_at),
      active: Boolean(raw.active),
    };
  }
}
