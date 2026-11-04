/**
 * Shared types for the Stellar DID & Compliance SDK.
 * These mirror the Soroban contract data structures.
 */

export interface DIDDocument {
  id: string; // did:stellar:<address>
  documentHash: string; // hex-encoded content hash of the off-chain document
  updatedAt: number; // ledger sequence
  active: boolean;
}

export interface AttributeRing {
  attribute: string;
  publicKeys: string[]; // hex-encoded BLS12-381 public keys (96 bytes each)
}

export interface RingSignature {
  challenge: string; // hex-encoded 32-byte scalar
  responses: string[]; // hex-encoded 32-byte scalars, one per ring member
}

export interface Credential {
  subject: string;
  attribute: string;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
}

export interface CompliancePolicy {
  name: string;
  requiredAttributes: string[];
  version: number;
}

export interface Attestation {
  subject: string;
  policy: string;
  compliant: boolean;
  evaluatedAt: number;
  policyVersion: number;
  verifier: string;
}

/**
 * Minimal shape of the Soroban RPC calls the SDK makes. Injected in tests;
 * production callers leave it unset and the SDK creates a real client.
 */
export interface SorobanServerLike {
  getAccount(accountId: string): Promise<unknown>;
  simulateTransaction(transaction: unknown): Promise<unknown>;
  prepareTransaction(transaction: unknown): Promise<unknown>;
}

export interface StellarDIDConfig {
  networkPassphrase: string;
  rpcUrl: string;
  didRegistryId: string;
  vcVerifierId: string;
  complianceEngineId: string;
  /**
   * Source account public key. Required only for building unsigned
   * transactions (`register`, `update`, `deactivate`).
   */
  publicKey?: string;
  /** Optional pre-built RPC client (used by tests). */
  server?: SorobanServerLike;
}
