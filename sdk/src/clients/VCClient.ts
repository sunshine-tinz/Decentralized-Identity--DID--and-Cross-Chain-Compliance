/**
 * VCClient — interact with the VC Verifier Soroban contract.
 *
 * TODO for contributors:
 *  - Implement generateRingSignature() using BLS12-381 (noble-bls12-381)
 *  - Implement verifyCredential() to submit proof on-chain
 *  - Add credential storage helpers (localStorage / secure enclave)
 */

import { StellarDIDConfig, AttributeRing, RingSignature } from "../types";

export class VCClient {
  private config: StellarDIDConfig;

  constructor(config: StellarDIDConfig) {
    this.config = config;
  }

  /**
   * Fetch the attribute ring from the contract (needed for signature generation).
   *
   * TODO: call VCVerifier.get_ring via SorobanRpc simulation
   */
  async getAttributeRing(attribute: string): Promise<AttributeRing> {
    // TODO: implement
    throw new Error("Not implemented");
  }

  /**
   * Generate a BLS ring signature proving membership in an attribute ring.
   *
   * This runs entirely client-side — no private key ever leaves the browser.
   *
   * @param ring       - The attribute ring fetched from the contract
   * @param userIndex  - Index of the user's key within the ring
   * @param privateKey - User's BLS private key (hex, 32 bytes)
   * @param message    - Challenge message to sign
   *
   * TODO: implement using noble-bls12-381 or equivalent
   */
  generateRingSignature(
    ring: AttributeRing,
    userIndex: number,
    privateKey: string,
    message: string
  ): RingSignature {
    // TODO: implement BLS12-381 ring signature algorithm
    throw new Error("Not implemented — see contracts/vc_verifier/src/lib.rs for the math");
  }

  /**
   * Submit a ring signature proof on-chain.
   *
   * TODO: build and submit Soroban transaction calling VCVerifier.verify_credential
   */
  async verifyCredential(
    attribute: string,
    message: string,
    signature: RingSignature
  ): Promise<boolean> {
    // TODO: implement
    throw new Error("Not implemented");
  }
}
