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
export * from "./types";

/**
 * Pre-configured Stellar Testnet contract addresses and RPC settings (Protocol 22+).
 */
export const TESTNET_CONFIG: StellarDIDConfig = {
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  didRegistryId: "CBPKUCAYGAFRKXKHRLLG7KZXCHQAGYRQLIGKPXOGLCZGZTMV5JN3SBBX",
  vcVerifierId: "CABOISTOEOYKQY46U2TU57DXOGLTQRTUB5THLS2ICMYXMDF2SA7L3UPJ",
  complianceEngineId: "CAZSHQLBCHWVCALAN4SNI3MB2IVD4UNS6PCZ763LK47N6IU3YCOP73TA",
};
