/**
 * @stellar-did/sdk
 *
 * Client SDK for interacting with the Stellar DID & Cross-Chain Compliance contracts.
 *
 * Usage:
 *   import { DIDClient, VCClient, ComplianceClient, TESTNET_CONFIG } from '@stellar-did/sdk';
 */

import { StellarDIDConfig } from "./types";

export { DIDClient } from "./clients/DIDClient";
export { VCClient } from "./clients/VCClient";
export { ComplianceClient } from "./clients/ComplianceClient";
export { submitSignedTransaction } from "./lib/soroban";
export {
  encodeEd25519Multibase,
  buildW3CDIDDocument,
  verifyOffchainDocumentHash,
  resolveW3CDID,
} from "./resolver/DIDResolver";
export {
  extractStellarAddressFromDid,
  hashUnsignedCredential,
  signW3CCredential,
  validateW3CCredentialSchema,
  verifyW3CCredential,
} from "./vc/W3CVerifiableCredential";
export type {
  W3CCredentialStatus,
  W3CCredentialProof,
  W3CVerifiableCredential,
} from "./vc/W3CVerifiableCredential";
export * from "./types";

/**
 * Pre-configured Stellar Testnet contract addresses and RPC settings (Protocol 22+).
 */
export const TESTNET_CONFIG: StellarDIDConfig = {
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  didRegistryId: "CAYT4IOLYKTQWBPYOY7ECIL2EGJMPCNYSGYDUQEQBQU475SU3SKVAXPG",
  vcVerifierId: "CDDVO64VECGNVZOKCGTBAEKVB27HE5P4JGZZTMMI5FZIY4SHWF5UM662",
  complianceEngineId: "CAZAZ3Y7HYVVP2DXWQM5QPJWVCBGO7SUDMVMPZQGNRURYWCYES74PUZW",
};
