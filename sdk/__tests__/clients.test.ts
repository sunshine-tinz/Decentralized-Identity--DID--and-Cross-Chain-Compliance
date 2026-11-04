import { Account, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { DIDClient } from "../src/clients/DIDClient";
import { VCClient } from "../src/clients/VCClient";
import { ComplianceClient } from "../src/clients/ComplianceClient";
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
});
