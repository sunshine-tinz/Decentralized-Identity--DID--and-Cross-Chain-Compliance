/**
 * VCClient — interact with the VC Verifier Soroban contract.
 *
 * Credentials in this version are issuer-attested (an admin-registered issuer
 * records an attribute with an expiry). Ring-signature proofs are **not**
 * available: the pinned Soroban SDK has no BLS12-381 host functions and no ring
 * signature construction is specified, so the on-chain verifier fails closed.
 * The methods that would rely on that path throw an explicit error instead of
 * pretending to work.
 */

import { Address } from "@stellar/stellar-sdk";
import { AttributeRing, Credential, RingSignature, StellarDIDConfig } from "../types";
import { simulateRead, symbolArg, toHex } from "../lib/soroban";

const RING_UNAVAILABLE =
  "BLS12-381 ring signatures are not available: the pinned soroban-sdk has no " +
  "BLS host functions and no ring-signature scheme is specified. Use " +
  "issuer-attested credentials (isCredentialValid) instead.";

export class VCClient {
  private config: StellarDIDConfig;

  constructor(config: StellarDIDConfig) {
    this.config = config;
  }

  /**
   * Fetch the attribute ring from the contract.
   */
  async getAttributeRing(attribute: string): Promise<AttributeRing> {
    const raw = (await simulateRead(
      this.config,
      this.config.vcVerifierId,
      "get_ring",
      [symbolArg(attribute)]
    )) as { attribute: string; public_keys: unknown[] };

    return {
      attribute: raw.attribute,
      publicKeys: (raw.public_keys ?? []).map((key) => toHex(key)),
    };
  }

  /**
   * Whether the contract can verify ring signatures. Always false today.
   */
  async ringVerificationAvailable(): Promise<boolean> {
    const available = await simulateRead(
      this.config,
      this.config.vcVerifierId,
      "ring_verification_available",
      []
    );
    return Boolean(available);
  }

  /**
   * Whether `subject` holds a currently valid credential for `attribute`.
   */
  async isCredentialValid(subject: string, attribute: string): Promise<boolean> {
    const valid = await simulateRead(
      this.config,
      this.config.vcVerifierId,
      "is_credential_valid",
      [Address.fromString(subject).toScVal(), symbolArg(attribute)]
    );
    return Boolean(valid);
  }

  /**
   * Read the stored credential, if any. Returns null when none exists.
   */
  async getCredential(subject: string, attribute: string): Promise<Credential | null> {
    const raw = (await simulateRead(
      this.config,
      this.config.vcVerifierId,
      "get_credential",
      [Address.fromString(subject).toScVal(), symbolArg(attribute)]
    )) as
      | {
          subject: string;
          attribute: string;
          issuer: string;
          issued_at: number;
          expires_at: number;
          revoked: boolean;
        }
      | null
      | undefined;

    if (!raw) return null;

    return {
      subject: raw.subject,
      attribute: raw.attribute,
      issuer: raw.issuer,
      issuedAt: Number(raw.issued_at),
      expiresAt: Number(raw.expires_at),
      revoked: Boolean(raw.revoked),
    };
  }

  /**
   * Generate a BLS ring signature client-side.
   *
   * @throws always — no implementation exists.
   */
  generateRingSignature(
    _ring: AttributeRing,
    _userIndex: number,
    _privateKey: string,
    _message: string
  ): RingSignature {
    throw new Error(RING_UNAVAILABLE);
  }

  /**
   * Submit a ring-signature proof on-chain.
   *
   * @throws always — verification is disabled and would reject every proof.
   */
  async verifyCredential(
    _attribute: string,
    _message: string,
    _signature: RingSignature
  ): Promise<boolean> {
    throw new Error(RING_UNAVAILABLE);
  }
}
