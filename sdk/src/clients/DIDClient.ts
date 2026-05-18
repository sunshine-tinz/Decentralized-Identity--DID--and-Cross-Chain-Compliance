/**
 * DIDClient — interact with the DID Registry Soroban contract.
 *
 * TODO for contributors:
 *  - Implement register() using stellar-sdk SorobanRpc
 *  - Implement resolve() with caching layer
 *  - Add update() and deactivate() methods
 *  - Add helper to generate a W3C DID document and compute its hash
 */

import { StellarDIDConfig, DIDDocument } from "../types";

export class DIDClient {
  private config: StellarDIDConfig;

  constructor(config: StellarDIDConfig) {
    this.config = config;
  }

  /**
   * Register a new DID for the given controller address.
   *
   * @param controllerAddress - Stellar address (G...)
   * @param documentHash      - SHA-256 hash of the off-chain DID document (hex)
   * @returns The DID string (did:stellar:<address>)
   *
   * TODO: build and submit Soroban transaction
   */
  async register(controllerAddress: string, documentHash: string): Promise<string> {
    // TODO: implement
    throw new Error("Not implemented — see contracts/did_registry/src/lib.rs");
  }

  /**
   * Resolve a DID document by controller address.
   *
   * TODO: call DIDRegistry.resolve via SorobanRpc simulation
   */
  async resolve(controllerAddress: string): Promise<DIDDocument> {
    // TODO: implement
    throw new Error("Not implemented");
  }
}
