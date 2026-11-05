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
    pagingToken: "100-1",
    contractId: CONTRACT_ID,
    inSuccessfulContractCall: true,
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

  it("drops events from a reverted contract call", () => {
    // A failed call is not ledger state; relaying its event would assert
    // compliance from a transaction that reverted.
    expect(listener({})._parseEvent(makeEvent({ inSuccessfulContractCall: false }))).toBeNull();
  });

  it("advances the cursor by paging token", async () => {
    const event = makeEvent({ pagingToken: "100-9", id: "0000000100-0000000009" });
    const server = {
      getEvents: async () => ({ events: [event] }), // no response cursor
      getLatestLedger: async () => ({ sequence: 100 }),
    };
    const l = listener(server);
    l._running = false;
    l.on("attestation", () => {});

    await l._poll();

    expect(l._cursor).toBe("100-9");
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

  // Regression for ACCEPTANCE-AUDIT.md H-2: the event id used to be recorded and
  // the cursor persisted before the (async, fire-and-forget) relay ran, so a failed
  // relay lost the attestation permanently.
  it("keeps an event pending when the relay fails, then retries it", async () => {
    const event = makeEvent();
    const server = {
      getEvents: async () => ({ events: [event], cursor: "cursor-1" }),
      getLatestLedger: async () => ({ sequence: 100 }),
    };
    const l = listener(server);
    l._running = false;
    let attempts = 0;
    l.on("attestation", async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("relay failed");
    });

    await l._poll();

    expect(attempts).toBe(1);
    expect(l._cursor).toBeNull();
    expect(l._processedIds).not.toContain(event.id);

    await l._poll();

    expect(attempts).toBe(2);
    expect(l._cursor).toBe("cursor-1");
    expect(l._processedIds).toContain(event.id);
  });

  it("does not relay an already-confirmed event twice after a later failure", async () => {
    const first = makeEvent();
    const second = makeEvent({ id: "0000000100-0000000002" });
    const server = {
      getEvents: async () => ({ events: [first, second], cursor: "cursor-1" }),
      getLatestLedger: async () => ({ sequence: 100 }),
    };
    const l = listener(server);
    l._running = false;
    const delivered = [];
    let fail = true;
    l.on("attestation", async (a) => {
      if (a.id === second.id && fail) throw new Error("relay failed");
      delivered.push(a.id);
    });

    await l._poll();
    expect(delivered).toEqual([first.id]);

    fail = false;
    await l._poll();
    expect(delivered).toEqual([first.id, second.id]);
  });

  it("filters on two distinct topic positions", async () => {
    const server = {
      getEvents: jest.fn(async () => ({ events: [], cursor: "cursor-1" })),
      getLatestLedger: async () => ({ sequence: 100 }),
    };
    const l = listener(server);
    l._running = false;
    await l._poll();

    const request = server.getEvents.mock.calls[0][0];
    expect(request.filters[0].topics).toHaveLength(2);
  });

  it("refuses to acknowledge an event when no handler is registered", async () => {
    const event = makeEvent();
    const server = {
      getEvents: async () => ({ events: [event], cursor: "cursor-1" }),
      getLatestLedger: async () => ({ sequence: 100 }),
    };
    const l = listener(server);
    l._running = false;
    const errors = [];
    l.on("pollError", (err) => errors.push(err));

    await l._poll();

    expect(errors.length).toBe(1);
    expect(l._cursor).toBeNull();
  });
});

describe("EVMRelayer", () => {
  // Attestations originate on Stellar, so the subject is a Stellar strkey. The
  // old validation required an EVM address and therefore rejected every event.
  const subject = Keypair.random().publicKey();

  const RECEIVER = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

  function relayerWith(receipt, contractOverrides = {}) {
    const contract = {
      target: RECEIVER,
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
    expect(sent[5]).toBe("0xsignature");
    expect(sent[4]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sent[3]).toBe(100n);
  });

  it("binds the receiver, chain id and ledger in the signed digest", async () => {
    const { relayer, wallet } = relayerWith({ status: 1 });
    await relayer.relay(attestation);

    const nonce = ethers.keccak256(ethers.toUtf8Bytes(attestation.id));
    const expected = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "string", "string", "bool", "uint256", "bytes32", "uint256"],
        [RECEIVER, subject, "defi_pool", true, 100n, nonce, 11155111n]
      )
    );

    // signMessage receives the raw 32-byte digest and applies the EIP-191 prefix.
    expect(ethers.hexlify(wallet.signMessage.mock.calls[0][0])).toBe(expected);
  });

  it("rejects a missing, negative or non-integer ledger", async () => {
    const { relayer, wallet } = relayerWith({ status: 1 });

    await expect(relayer.relay({ ...attestation, ledger: undefined })).rejects.toThrow(/ledger/);
    await expect(relayer.relay({ ...attestation, ledger: -1 })).rejects.toThrow(/negative/);
    await expect(relayer.relay({ ...attestation, ledger: "abc" })).rejects.toThrow(/integer/);
    expect(wallet.signMessage).not.toHaveBeenCalled();
  });

  it("refuses to sign when the receiver address is unknown", async () => {
    const { relayer, wallet } = relayerWith({ status: 1 }, { target: undefined });
    await expect(relayer.relay(attestation)).rejects.toThrow(/receiver address/);
    expect(wallet.signMessage).not.toHaveBeenCalled();
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

  // Regression for ACCEPTANCE-AUDIT.md M-3: a missing network used to yield
  // chainId 0 and a signature over it rather than an error.
  it("refuses to sign when the chain id cannot be read", async () => {
    const { relayer, contract, wallet } = relayerWith({ status: 1 }, { runner: { provider: {} } });
    await expect(relayer.relay(attestation)).rejects.toThrow(/chain id/);
    expect(wallet.signMessage).not.toHaveBeenCalled();
    expect(contract.receiveAttestation).not.toHaveBeenCalled();
  });

  it("relays an event produced by the listener (Stellar subject regression)", async () => {
    const parsed = new StellarListener({
      complianceContractId: CONTRACT_ID,
      server: {},
      cursorFile: null,
    })._parseEvent(makeEvent());
    expect(parsed).not.toBeNull();

    const { relayer, contract } = relayerWith({ status: 1 });
    await expect(relayer.relay(parsed)).resolves.toBe("0xabc");
    expect(contract.receiveAttestation.mock.calls[0][0]).toBe(parsed.subject);
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
