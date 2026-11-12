/**
 * Off-chain W3C DID Core v1.0 Resolver for `did:stellar:` identifiers.
 *
 * Trust assumptions:
 *  - On-chain authority (`DIDRegistry`) is the canonical source of active status,
 *    current controller address, version, service endpoints, and document hash.
 *  - Off-chain DID JSON documents must hash (SHA-256) to the anchored
 *    `documentHash` when integrity verification is requested.
 */

import crypto from "crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { DIDClient } from "../clients/DIDClient";
import {
  DIDDocument,
  StellarDIDConfig,
  W3CDIDDocument,
  W3CDIDResolutionResult,
} from "../types";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits = [0];
  for (let i = 0; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i += 1) {
    result += "1";
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

/**
 * Encode a Stellar Ed25519 StrKey (`G...`) into a W3C multibase (`z`) multicodec
 * Ed25519 public key (`0xed01` prefix + 32-byte key).
 */
export function encodeEd25519Multibase(stellarAddress: string): string {
  if (!StrKey.isValidEd25519PublicKey(stellarAddress)) {
    throw new Error(`Invalid Stellar Ed25519 public key: ${stellarAddress}`);
  }
  const rawKey = StrKey.decodeEd25519PublicKey(stellarAddress);
  const prefixed = new Uint8Array(2 + rawKey.length);
  prefixed[0] = 0xed;
  prefixed[1] = 0x01;
  prefixed.set(rawKey, 2);
  return `z${encodeBase58(prefixed)}`;
}

export function buildW3CDIDDocument(anchor: DIDDocument): W3CDIDDocument {
  const fallbackController = anchor.id.startsWith("did:stellar:")
    ? anchor.id.slice("did:stellar:".length)
    : "";
  const controllerAddress = anchor.controller || fallbackController;
  const controllerDid = `did:stellar:${controllerAddress}`;
  const keyId = `${anchor.id}#key-1`;

  const doc: W3CDIDDocument = {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1",
    ],
    id: anchor.id,
    controller: controllerDid,
    verificationMethod: anchor.active
      ? [
          {
            id: keyId,
            type: "Ed25519VerificationKey2020",
            controller: controllerDid,
            publicKeyMultibase: encodeEd25519Multibase(controllerAddress),
          },
        ]
      : [],
    authentication: anchor.active ? [keyId] : [],
    assertionMethod: anchor.active ? [keyId] : [],
  };

  if (anchor.services && anchor.services.length > 0) {
    doc.service = anchor.services.map((s) => ({
      id: s.id.startsWith("#") ? `${anchor.id}${s.id}` : s.id,
      type: s.serviceType,
      serviceEndpoint: s.endpoint,
    }));
  }

  return doc;
}

export function verifyOffchainDocumentHash(
  offchainDocument: string | Buffer,
  anchoredHashHex: string
): boolean {
  const actual = crypto.createHash("sha256").update(offchainDocument).digest("hex");
  return actual.toLowerCase() === anchoredHashHex.toLowerCase();
}

export async function resolveW3CDID(
  config: StellarDIDConfig,
  identifierOrAddress: string,
  options: { offchainDocument?: string | Buffer } = {}
): Promise<W3CDIDResolutionResult> {
  const client = new DIDClient(config);
  const anchor = identifierOrAddress.startsWith("did:stellar:")
    ? await client.resolveById(identifierOrAddress)
    : await client.resolve(identifierOrAddress);

  const didDocument = buildW3CDIDDocument(anchor);
  const offchainIntegrityVerified =
    options.offchainDocument !== undefined
      ? verifyOffchainDocumentHash(options.offchainDocument, anchor.documentHash)
      : undefined;

  return {
    didDocument,
    didDocumentMetadata: {
      deactivated: !anchor.active,
      versionId: String(anchor.version ?? 1),
      updatedLedger: anchor.updatedAt,
      documentHash: anchor.documentHash,
      ...(offchainIntegrityVerified !== undefined ? { offchainIntegrityVerified } : {}),
    },
    didResolutionMetadata: {
      contentType: "application/did+ld+json",
    },
  };
}
