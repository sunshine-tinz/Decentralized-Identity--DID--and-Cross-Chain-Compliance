/**
 * Shared types for the Stellar DID & Compliance SDK.
 * These mirror the Soroban contract data structures.
 */

export interface ServiceEndpoint {
  id: string;
  serviceType: string;
  endpoint: string;
}

export interface DIDDocument {
  id: string; // did:stellar:<anchor>
  controller?: string; // current Stellar controller (G...)
  recovery?: string | null; // optional recovery guardian (G...)
  documentHash: string; // hex-encoded content hash of the off-chain document
  services?: ServiceEndpoint[];
  version?: number;
  updatedAt: number; // ledger sequence
  active: boolean;
}

export interface W3CVerificationMethod {
  id: string;
  type: "Ed25519VerificationKey2020";
  controller: string;
  publicKeyMultibase: string;
}

export interface W3CServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export interface W3CDIDDocument {
  "@context": string[];
  id: string;
  controller: string;
  verificationMethod: W3CVerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  service?: W3CServiceEndpoint[];
}

export interface W3CDIDResolutionResult {
  didDocument: W3CDIDDocument;
  didDocumentMetadata: {
    deactivated: boolean;
    versionId: string;
    updatedLedger: number;
    documentHash: string;
    offchainIntegrityVerified?: boolean;
  };
  didResolutionMetadata: {
    contentType: "application/did+ld+json";
  };
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
  sendTransaction?(transaction: unknown): Promise<{
    status: string;
    hash?: string;
    errorResult?: unknown;
  }>;
  getTransaction?(hash: string): Promise<{
    status: string;
    ledger?: number;
    returnValue?: unknown;
    resultXdr?: unknown;
  }>;
}

export interface SubmittedTransactionResult {
  hash: string;
  status: "SUCCESS";
  ledger: number;
  returnValue?: unknown;
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
