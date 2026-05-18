/**
 * Shared types for the Stellar DID & Compliance SDK.
 * These mirror the Soroban contract data structures.
 */

export interface DIDDocument {
  id: string;           // did:stellar:<address>
  documentHash: string; // hex-encoded SHA-256 of the off-chain document
  updatedAt: number;    // ledger sequence
  active: boolean;
}

export interface AttributeRing {
  attribute: string;
  publicKeys: string[]; // hex-encoded BLS12-381 public keys (96 bytes each)
}

export interface RingSignature {
  challenge: string;   // hex-encoded 32-byte scalar
  responses: string[]; // hex-encoded 32-byte scalars, one per ring member
}

export interface ComplianceStatus {
  address: string;
  policy: string;
  compliant: boolean;
  evaluatedAt: number; // ledger sequence
}

export interface StellarDIDConfig {
  networkPassphrase: string;
  rpcUrl: string;
  didRegistryId: string;
  vcVerifierId: string;
  complianceEngineId: string;
}
