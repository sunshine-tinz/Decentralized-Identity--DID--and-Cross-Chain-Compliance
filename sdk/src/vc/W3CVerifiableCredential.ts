/**
 * W3C Verifiable Credential Data Model helpers with Ed25519 proof verification
 * and optional Soroban VCVerifier on-chain status & hash-anchor verification.
 */

import crypto from "crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { VCClient } from "../clients/VCClient";

export interface W3CCredentialStatus {
  id: string;
  type: "SorobanCredentialStatus2026";
  contractId: string;
  subject: string;
  attributes: string[];
  expiresAtLedger?: number;
}

export interface W3CCredentialProof {
  type: "Ed25519Signature2020";
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  proofValue: string;
}

export interface W3CVerifiableCredential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: {
    id: string;
    attributes: Record<string, boolean>;
  };
  credentialStatus: W3CCredentialStatus;
  proof: W3CCredentialProof;
}

const REQUIRED_CONTEXT = "https://www.w3.org/2018/credentials/v1";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(",")}}`;
}

export function extractStellarAddressFromDid(did: string): string {
  if (typeof did !== "string" || !did.startsWith("did:stellar:")) {
    throw new Error(`Unsupported DID format: ${did}`);
  }
  const addr = did.slice("did:stellar:".length);
  if (!StrKey.isValidEd25519PublicKey(addr)) {
    throw new Error(`Invalid Stellar address in DID: ${did}`);
  }
  return addr;
}

export function hashUnsignedCredential(
  vcWithoutProof: Omit<W3CVerifiableCredential, "proof">
): string {
  const canonical = canonicalize(vcWithoutProof);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function signW3CCredential(
  vcWithoutProof: Omit<W3CVerifiableCredential, "proof">,
  issuerSecretKey: string,
  created = new Date().toISOString()
): W3CVerifiableCredential {
  const keypair = Keypair.fromSecret(issuerSecretKey);
  const expectedIssuerDid = `did:stellar:${keypair.publicKey()}`;
  if (vcWithoutProof.issuer !== expectedIssuerDid) {
    throw new Error(
      `Issuer DID ${vcWithoutProof.issuer} does not match signing key ${expectedIssuerDid}`
    );
  }

  const digestHex = hashUnsignedCredential(vcWithoutProof);
  const sig = Buffer.from(keypair.sign(Buffer.from(digestHex, "hex"))).toString("base64");

  return {
    ...vcWithoutProof,
    proof: {
      type: "Ed25519Signature2020",
      created,
      verificationMethod: `${expectedIssuerDid}#key-1`,
      proofPurpose: "assertionMethod",
      proofValue: sig,
    },
  };
}

export function validateW3CCredentialSchema(vc: unknown): { ok: true } | { ok: false; error: string } {
  if (!vc || typeof vc !== "object") {
    return { ok: false, error: "Credential must be an object" };
  }
  const c = vc as Partial<W3CVerifiableCredential>;

  if (!Array.isArray(c["@context"]) || !c["@context"].includes(REQUIRED_CONTEXT)) {
    return { ok: false, error: `@context must include ${REQUIRED_CONTEXT}` };
  }
  if (typeof c.id !== "string" || !c.id.length) {
    return { ok: false, error: "id is required" };
  }
  if (!Array.isArray(c.type) || !c.type.includes("VerifiableCredential")) {
    return { ok: false, error: "type must include VerifiableCredential" };
  }
  if (typeof c.issuer !== "string") {
    return { ok: false, error: "issuer DID is required" };
  }
  try {
    extractStellarAddressFromDid(c.issuer);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  if (
    typeof c.issuanceDate !== "string" ||
    Number.isNaN(Date.parse(c.issuanceDate)) ||
    typeof c.expirationDate !== "string" ||
    Number.isNaN(Date.parse(c.expirationDate))
  ) {
    return { ok: false, error: "valid issuanceDate and expirationDate ISO timestamps are required" };
  }

  if (
    !c.credentialSubject ||
    typeof c.credentialSubject.id !== "string" ||
    !c.credentialSubject.attributes ||
    typeof c.credentialSubject.attributes !== "object"
  ) {
    return { ok: false, error: "credentialSubject with id and attributes is required" };
  }

  try {
    extractStellarAddressFromDid(c.credentialSubject.id);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  if (
    !c.credentialStatus ||
    c.credentialStatus.type !== "SorobanCredentialStatus2026" ||
    !Array.isArray(c.credentialStatus.attributes) ||
    c.credentialStatus.attributes.length === 0
  ) {
    return { ok: false, error: "credentialStatus is missing or malformed" };
  }

  if (
    !c.proof ||
    c.proof.type !== "Ed25519Signature2020" ||
    c.proof.proofPurpose !== "assertionMethod" ||
    typeof c.proof.verificationMethod !== "string" ||
    typeof c.proof.proofValue !== "string"
  ) {
    return { ok: false, error: "Ed25519Signature2020 proof is missing or malformed" };
  }

  return { ok: true };
}

export async function verifyW3CCredential(
  vc: W3CVerifiableCredential,
  options: { now?: Date; vcClient?: VCClient } = {}
): Promise<{ valid: boolean; reason?: string; digestHex?: string }> {
  const schema = validateW3CCredentialSchema(vc);
  if (!schema.ok) {
    return { valid: false, reason: schema.error };
  }

  const now = options.now ?? new Date();
  const issuedAtMs = Date.parse(vc.issuanceDate);
  const expiresAtMs = Date.parse(vc.expirationDate);
  if (now.getTime() < issuedAtMs) {
    return { valid: false, reason: "Credential is not yet valid" };
  }
  if (now.getTime() >= expiresAtMs) {
    return { valid: false, reason: "Credential has expired" };
  }

  const issuerAddress = extractStellarAddressFromDid(vc.issuer);
  if (!vc.proof.verificationMethod.startsWith(`${vc.issuer}#`)) {
    return { valid: false, reason: "Proof verificationMethod does not match issuer DID" };
  }

  const { proof, ...unsigned } = vc;
  const digestHex = hashUnsignedCredential(unsigned);

  let sigOk = false;
  try {
    sigOk = Keypair.fromPublicKey(issuerAddress).verify(
      Buffer.from(digestHex, "hex"),
      Buffer.from(proof.proofValue, "base64")
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return { valid: false, reason: "Invalid Ed25519 credential proof signature" };
  }

  // Optional live Soroban status + anchor verification
  if (options.vcClient) {
    const subjectAddress = extractStellarAddressFromDid(vc.credentialSubject.id);
    for (const attr of vc.credentialStatus.attributes) {
      const validOnChain = await options.vcClient.isCredentialValid(subjectAddress, attr);
      if (!validOnChain) {
        return {
          valid: false,
          reason: `On-chain credential status invalid or revoked for attribute ${attr}`,
        };
      }
      const anchored = await options.vcClient.getCredentialHash(subjectAddress, attr);
      if (anchored && anchored.toLowerCase() !== digestHex.toLowerCase()) {
        return {
          valid: false,
          reason: `Anchored VC digest mismatch for attribute ${attr}`,
        };
      }
    }
  }

  return { valid: true, digestHex };
}
