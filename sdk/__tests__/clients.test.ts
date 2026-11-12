import crypto from "crypto";
import { describe, expect, it, vi } from "vitest";
import { Account, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { DIDClient } from "../src/clients/DIDClient";
import { VCClient } from "../src/clients/VCClient";
import { ComplianceClient } from "../src/clients/ComplianceClient";
import { submitSignedTransaction } from "../src/lib/soroban";
import { resolveW3CDID } from "../src/resolver/DIDResolver";
import {
  hashUnsignedCredential,
  signW3CCredential,
  validateW3CCredentialSchema,
  verifyW3CCredential,
} from "../src/vc/W3CVerifiableCredential";
import { StellarDIDConfig } from "../src/types";

const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const PUBKEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * Build an ScMap that matches how `contracttype` structs are encoded
 * (symbol keys).
 */
function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(fields).map(
      ([key, val]) =>
        new xdr.ScMapEntry({ key: nativeToScVal(key, { type: "symbol" }), val })
    )
  );
}

function configWith(server: any, extra: Partial<StellarDIDConfig> = {}): StellarDIDConfig {
  return {
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://example.invalid",
    didRegistryId: CONTRACT,
    vcVerifierId: CONTRACT,
    complianceEngineId: CONTRACT,
    server,
    ...extra,
  };
}

function serverReturning(retval: xdr.ScVal, prepare?: (tx: any) => any) {
  return {
    getAccount: async () => new Account(PUBKEY, "0"),
    simulateTransaction: async () => ({ result: { retval } }),
    prepareTransaction: async (tx: any) => (prepare ? prepare(tx) : tx),
  };
}

function serverFailing(error: string) {
  return {
    getAccount: async () => new Account(PUBKEY, "0"),
    simulateTransaction: async () => ({ error }),
    prepareTransaction: async (tx: any) => tx,
  };
}

describe("DIDClient", () => {
  it("decodes a resolved DID document", async () => {
    const retval = struct({
      id: nativeToScVal("did:stellar:" + Keypair.random().publicKey()),
      document_hash: nativeToScVal(Buffer.alloc(32, 0xab), { type: "bytes" }),
      updated_at: nativeToScVal(1234, { type: "u32" }),
      active: nativeToScVal(true, { type: "bool" }),
    });

    const client = new DIDClient(configWith(serverReturning(retval)));
    const doc = await client.resolve(Keypair.random().publicKey());

    expect(doc.documentHash).toBe("ab".repeat(32));
    expect(doc.updatedAt).toBe(1234);
    expect(doc.active).toBe(true);
    expect(doc.id.startsWith("did:stellar:")).toBe(true);
  });

  it("requires a public key to build a register transaction", async () => {
    const client = new DIDClient(configWith(serverReturning(nativeToScVal(true))));
    await expect(
      client.register(Keypair.random().publicKey(), "ab".repeat(32))
    ).rejects.toThrow(/publicKey is required/);
  });

  it("builds and prepares an unsigned register transaction", async () => {
    const client = new DIDClient(
      configWith(serverReturning(nativeToScVal(true)), { publicKey: PUBKEY })
    );

    const xdrString = await client.register(Keypair.random().publicKey(), "ab".repeat(32));
    expect(typeof xdrString).toBe("string");
    expect(xdrString.length).toBeGreaterThan(0);
  });

  it("rejects a non-hex document hash", async () => {
    const client = new DIDClient(
      configWith(serverReturning(nativeToScVal(true)), { publicKey: PUBKEY })
    );
    await expect(
      client.register(Keypair.random().publicKey(), "not-hex!")
    ).rejects.toThrow(/hex/);
  });

  it("surfaces simulation errors", async () => {
    const client = new DIDClient(configWith(serverFailing("boom")));
    await expect(client.resolve(Keypair.random().publicKey())).rejects.toThrow(/boom/);
  });
});

describe("VCClient", () => {
  it("decodes an attribute ring", async () => {
    const retval = struct({
      attribute: nativeToScVal("kyc_passed", { type: "symbol" }),
      public_keys: xdr.ScVal.scvVec([
        nativeToScVal(Buffer.alloc(96, 1), { type: "bytes" }),
        nativeToScVal(Buffer.alloc(96, 2), { type: "bytes" }),
      ]),
    });

    const client = new VCClient(configWith(serverReturning(retval)));
    const ring = await client.getAttributeRing("kyc_passed");

    expect(ring.attribute).toBe("kyc_passed");
    expect(ring.publicKeys).toHaveLength(2);
    expect(ring.publicKeys[0]).toBe("01".repeat(96));
  });

  it("reports that ring verification is unavailable", async () => {
    const client = new VCClient(configWith(serverReturning(nativeToScVal(false))));
    expect(await client.ringVerificationAvailable()).toBe(false);
  });

  it("reads credential validity", async () => {
    const client = new VCClient(configWith(serverReturning(nativeToScVal(true))));
    expect(
      await client.isCredentialValid(Keypair.random().publicKey(), "kyc_passed")
    ).toBe(true);
  });

  it("throws a precise error instead of faking a ring signature", () => {
    const client = new VCClient(configWith(serverReturning(nativeToScVal(true))));
    expect(() =>
      client.generateRingSignature(
        { attribute: "kyc_passed", publicKeys: [] },
        0,
        "00",
        "msg"
      )
    ).toThrow(/BLS12-381 ring signatures are not available/);
  });

  it("refuses to submit ring proofs", async () => {
    const client = new VCClient(configWith(serverReturning(nativeToScVal(true))));
    await expect(
      client.verifyCredential("kyc_passed", "msg", { challenge: "00", responses: [] })
    ).rejects.toThrow(/not available/);
  });
});

describe("ComplianceClient", () => {
  it("reads compliance", async () => {
    const client = new ComplianceClient(configWith(serverReturning(nativeToScVal(false))));
    expect(await client.isCompliant(Keypair.random().publicKey(), "defi_pool")).toBe(false);
  });

  it("decodes a policy", async () => {
    const retval = struct({
      name: nativeToScVal("defi_pool", { type: "symbol" }),
      required_attributes: xdr.ScVal.scvVec([
        nativeToScVal("kyc_passed", { type: "symbol" }),
      ]),
      version: nativeToScVal(2, { type: "u32" }),
    });

    const client = new ComplianceClient(configWith(serverReturning(retval)));
    const policy = await client.getPolicy("defi_pool");

    expect(policy.name).toBe("defi_pool");
    expect(policy.requiredAttributes).toEqual(["kyc_passed"]);
    expect(policy.version).toBe(2);
  });

  it("decodes an attestation snapshot", async () => {
    const subject = Keypair.random().publicKey();
    const retval = struct({
      subject: nativeToScVal(subject, { type: "address" }),
      policy: nativeToScVal("defi_pool", { type: "symbol" }),
      compliant: nativeToScVal(true, { type: "bool" }),
      evaluated_at: nativeToScVal(999, { type: "u32" }),
      policy_version: nativeToScVal(3, { type: "u32" }),
      verifier: nativeToScVal(CONTRACT, { type: "address" }),
    });

    const client = new ComplianceClient(configWith(serverReturning(retval)));
    const attestation = await client.exportAttestation(subject, "defi_pool");

    expect(attestation.compliant).toBe(true);
    expect(attestation.evaluatedAt).toBe(999);
    expect(attestation.policyVersion).toBe(3);
    expect(attestation.verifier).toBe(CONTRACT);
  });

  it("submits a valid signed transaction and polls until SUCCESS", async () => {
    const server = {
      ...serverReturning(nativeToScVal(true)),
      sendTransaction: vi.fn(async () => ({ status: "PENDING", hash: "tx-hash-1" })),
      getTransaction: vi
        .fn()
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({
          status: "SUCCESS",
          ledger: 4242,
          returnValue: nativeToScVal("did:stellar:" + PUBKEY),
        }),
    };

    const client = new DIDClient(configWith(server, { publicKey: PUBKEY }));
    const xdrStr = await client.register(PUBKEY, "ab".repeat(32));
    const receipt = await submitSignedTransaction(configWith(server), xdrStr, {
      pollIntervalMs: 1,
      pollTimeoutMs: 500,
    });

    expect(receipt.hash).toBe("tx-hash-1");
    expect(receipt.status).toBe("SUCCESS");
    expect(receipt.ledger).toBe(4242);
    expect(receipt.returnValue).toBe("did:stellar:" + PUBKEY);
  });

  it("rejects invalid XDR and failed RPC submissions", async () => {
    const server = {
      ...serverReturning(nativeToScVal(true)),
      sendTransaction: vi.fn(async () => ({ status: "ERROR" })),
      getTransaction: vi.fn(),
    };

    await expect(submitSignedTransaction(configWith(server), "not-valid-xdr")).rejects.toThrow(
      /Invalid signed transaction XDR/
    );

    const client = new DIDClient(configWith(server, { publicKey: PUBKEY }));
    const xdrStr = await client.register(PUBKEY, "ab".repeat(32));
    await expect(submitSignedTransaction(configWith(server), xdrStr)).rejects.toThrow(
      /rejected transaction submission/
    );
  });
});

describe("W3C DID Core Resolver & Verifiable Credentials", () => {
  it("resolves an on-chain DID anchor into a W3C DID Core document and verifies off-chain hash", async () => {
    const controller = Keypair.random().publicKey();
    const didId = `did:stellar:${controller}`;
    const offchainDoc = JSON.stringify({ id: didId, service: [] });
    const docHash = crypto.createHash("sha256").update(offchainDoc).digest();

    const retval = struct({
      id: nativeToScVal(didId),
      controller: nativeToScVal(controller, { type: "address" }),
      document_hash: nativeToScVal(docHash, { type: "bytes" }),
      services: xdr.ScVal.scvVec([
        struct({
          id: nativeToScVal("#kyc"),
          service_type: nativeToScVal("KYCService"),
          endpoint: nativeToScVal("https://kyc.example.org"),
        }),
      ]),
      version: nativeToScVal(2, { type: "u32" }),
      updated_at: nativeToScVal(5555, { type: "u32" }),
      active: nativeToScVal(true, { type: "bool" }),
    });

    const resolved = await resolveW3CDID(configWith(serverReturning(retval)), didId, {
      offchainDocument: offchainDoc,
    });

    expect(resolved.didDocument["@context"]).toContain("https://www.w3.org/ns/did/v1");
    expect(resolved.didDocument.id).toBe(didId);
    expect(resolved.didDocument.verificationMethod[0].type).toBe("Ed25519VerificationKey2020");
    expect(resolved.didDocument.verificationMethod[0].publicKeyMultibase.startsWith("z")).toBe(
      true
    );
    expect(resolved.didDocument.service?.[0].id).toBe(`${didId}#kyc`);
    expect(resolved.didDocumentMetadata.versionId).toBe("2");
    expect(resolved.didDocumentMetadata.offchainIntegrityVerified).toBe(true);
  });

  it("signs, validates schema, and verifies W3C Verifiable Credentials against forgery, substitution, expiry, and revocation", async () => {
    const issuerKp = Keypair.random();
    const attackerKp = Keypair.random();
    const subjectKp = Keypair.random();

    const unsigned = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://w3id.org/security/suites/ed25519-2020/v1",
      ],
      id: "urn:uuid:11111111-1111-4111-8111-111111111111",
      type: ["VerifiableCredential", "KYCComplianceCredential"],
      issuer: `did:stellar:${issuerKp.publicKey()}`,
      issuanceDate: "2026-01-01T00:00:00.000Z",
      expirationDate: "2027-01-01T00:00:00.000Z",
      credentialSubject: {
        id: `did:stellar:${subjectKp.publicKey()}`,
        attributes: { kyc_passed: true },
      },
      credentialStatus: {
        id: `stellar:soroban:${CONTRACT}#${subjectKp.publicKey()}:kyc_passed`,
        type: "SorobanCredentialStatus2026" as const,
        contractId: CONTRACT,
        subject: subjectKp.publicKey(),
        attributes: ["kyc_passed"],
        expiresAtLedger: 6_000_000,
      },
    };

    const signed = signW3CCredential(unsigned, issuerKp.secret());
    expect(validateW3CCredentialSchema(signed).ok).toBe(true);

    const expectedDigest = hashUnsignedCredential(unsigned);
    const validRes = await verifyW3CCredential(signed, {
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(validRes.valid).toBe(true);
    expect(validRes.digestHex).toBe(expectedDigest);

    // Tampered claim fails signature
    const tampered = {
      ...signed,
      credentialSubject: {
        ...signed.credentialSubject,
        attributes: { kyc_passed: true, accredited_investor: true },
      },
    };
    expect((await verifyW3CCredential(tampered, { now: new Date("2026-06-01T00:00:00.000Z") })).valid).toBe(
      false
    );

    // Issuer substitution fails
    const substituted = {
      ...signed,
      issuer: `did:stellar:${attackerKp.publicKey()}`,
    };
    expect(
      (await verifyW3CCredential(substituted, { now: new Date("2026-06-01T00:00:00.000Z") })).valid
    ).toBe(false);

    // Expired VC fails
    expect(
      (await verifyW3CCredential(signed, { now: new Date("2028-01-01T00:00:00.000Z") })).valid
    ).toBe(false);

    // Revoked on-chain status fails
    const revokedVcClient = new VCClient(configWith(serverReturning(nativeToScVal(false))));
    const revokedCheck = await verifyW3CCredential(signed, {
      now: new Date("2026-06-01T00:00:00.000Z"),
      vcClient: revokedVcClient,
    });
    expect(revokedCheck.valid).toBe(false);
    expect(revokedCheck.reason).toMatch(/revoked/i);
  });
});
