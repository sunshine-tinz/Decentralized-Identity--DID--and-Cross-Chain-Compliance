"use strict";

const { Keypair, nativeToScVal, xdr } = require("@stellar/stellar-sdk");
const { ethers } = require("ethers");

const { StellarListener } = require("../src/lib/stellarListener");
const { EVMRelayer } = require("../src/lib/evmRelayer");

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

function makeEvent(overrides = {}) {
  const subject = Keypair.random().publicKey();
  const topics = [
    nativeToScVal("compliance", { type: "symbol" }),
    nativeToScVal("attestation", { type: "symbol" }),
  ];
  const value = xdr.ScVal.scvVec([
    nativeToScVal(subject, { type: "address" }),
    nativeToScVal("defi_pool", { type: "symbol" }),
    nativeToScVal(true, { type: "bool" }),
  ]);

  return {
    id: "0000000100-0000000001",
    contractId: CONTRACT_ID,
    topic: topics,
    value,
    ledger: 100,
    ...overrides,
  };
}

describe("StellarListener event parsing", () => {
  function listener(server) {
    return new StellarListener({
      complianceContractId: CONTRACT_ID,
      server,
      cursorFile: null,
      pollIntervalMs: 100_000,
    });
  }

  it("decodes a well-formed attestation event", () => {
    const parsed = listener({})._parseEvent(makeEvent());
    expect(parsed).not.toBeNull();
    expect(parsed.policy).toBe("defi_pool");
    expect(parsed.compliant).toBe(true);
    expect(parsed.id).toBe("0000000100-0000000001");
  });

  it("drops events from another contract", () => {
    const event = makeEvent({ contractId: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" });
    expect(listener({})._parseEvent(event)).toBeNull();
  });

  it("drops events with the wrong topic namespace", () => {
    const event = makeEvent();
    event.topic = [
      nativeToScVal("other", { type: "symbol" }),
      nativeToScVal("attestation", { type: "symbol" }),
    ];
    expect(listener({})._parseEvent(event)).toBeNull();
  });

  it("drops an event with a non-boolean compliance flag", () => {
    const event = makeEvent();
    event.value = xdr.ScVal.scvVec([
      nativeToScVal(Keypair.random().publicKey(), { type: "address" }),
      nativeToScVal("defi_pool", { type: "symbol" }),
      nativeToScVal("true", { type: "string" }),
    ]);
    expect(listener({})._parseEvent(event)).toBeNull();
  });

  it("drops malformed input without throwing", () => {
    const l = listener({});
    expect(l._parseEvent(null)).toBeNull();
    expect(l._parseEvent({})).toBeNull();
    expect(l._parseEvent({ contractId: CONTRACT_ID, topic: [], value: null })).toBeNull();
  });

  it("does not fabricate attestations from unrelated effects", async () => {
    // Regression for AUDIT.md C-10: the old parser turned any object into
    // `{ policy: "unknown", compliant: true }`.
    const server = {
      getEvents: async () => ({ events: [{ type: "contract_credited", account: "G..." }] }),
      getLatestLedger: async () => ({ sequence: 100 }),
    };
    const l = listener(server);
    l._running = false;
    const seen = [];
    l.on("attestation", (a) => seen.push(a));
    await l._poll();
    expect(seen).toHaveLength(0);
  });

  it("emits each event id once", async () => {
    const server = {
      getEvents: async () => ({ events: [makeEvent()], cursor: "cursor-1" }),
      getLatestLedger: async () => ({ sequence: 100 }),
    };
    const l = listener(server);
    l._running = false;
    const seen = [];
    l.on("attestation", (a) => seen.push(a));

    await l._poll();
    await l._poll();

    expect(seen).toHaveLength(1);
    expect(l._cursor).toBe("cursor-1");
  });
});

describe("EVMRelayer", () => {
  const subject = ethers.Wallet.createRandom().address;

  function relayerWith(receipt, contractOverrides = {}) {
    const contract = {
      receiveAttestation: jest.fn(async () => ({
        hash: "0xabc",
        wait: async () => receipt,
      })),
      runner: { provider: { getNetwork: async () => ({ chainId: 11155111 }) } },
      ...contractOverrides,
    };
    const wallet = { signMessage: jest.fn(async () => "0xsignature") };
    return { relayer: new EVMRelayer({ contract, wallet }), contract, wallet };
  }

  const attestation = {
    id: "0000000100-0000000001",
    subject,
    policy: "defi_pool",
    compliant: true,
    ledger: 100,
  };

  it("returns the hash of a confirmed transaction", async () => {
    const { relayer, contract, wallet } = relayerWith({ status: 1 });
    const hash = await relayer.relay(attestation);

    expect(hash).toBe("0xabc");
    expect(wallet.signMessage).toHaveBeenCalledTimes(1);
    expect(contract.receiveAttestation).toHaveBeenCalledTimes(1);

    // The old implementation sent the literal bytes "stub-signature".
    const sent = contract.receiveAttestation.mock.calls[0];
    expect(sent[4]).toBe("0xsignature");
    expect(sent[3]).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects a reverted transaction (regression: reverted tx reported as success)", async () => {
    const { relayer } = relayerWith({ status: 0 });
    await expect(relayer.relay(attestation)).rejects.toThrow(/reverted/);
  });

  it("rejects a missing receipt", async () => {
    const { relayer } = relayerWith(null);
    await expect(relayer.relay(attestation)).rejects.toThrow(/reverted/);
  });

  it("fails closed when unconfigured", async () => {
    const relayer = new EVMRelayer({});
    expect(relayer.enabled).toBe(false);
    await expect(relayer.relay(attestation)).rejects.toThrow(/not configured/);
  });

  it("rejects malformed attestations", async () => {
    const { relayer } = relayerWith({ status: 1 });
    await expect(relayer.relay({ ...attestation, subject: "not-an-address" })).rejects.toThrow(
      /subject/
    );
    await expect(relayer.relay({ ...attestation, compliant: "true" })).rejects.toThrow(
      /compliant/
    );
    await expect(relayer.relay({ ...attestation, id: undefined })).rejects.toThrow(/id/);
  });
});
