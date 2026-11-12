"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Contract, Keypair, nativeToScVal, xdr } = require("@stellar/stellar-sdk");
const { ethers } = require("ethers");

const { StellarListener } = require("../src/lib/stellarListener");
const { EVMRelayer } = require("../src/lib/evmRelayer");
const {
  IdentityRegistry,
  buildLinkMessage,
  buildRevokeMessage,
} = require("../src/lib/identityRegistry");
const { EventQueue, STATES } = require("../src/lib/eventQueue");
const { ComplianceBridge } = require("../src/index");

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

async function createLinkedIdentity(registry, stellarKp, evmWallet, version = 1) {
  const stellarAddress = stellarKp.publicKey();
  const evmAddress = evmWallet.address;
  const msg = buildLinkMessage({ stellarAddress, evmAddress, version });
  const stellarSignature = stellarKp.sign(Buffer.from(msg, "utf8")).toString("base64");
  const evmSignature = await evmWallet.signMessage(msg);
  return registry.registerMapping({
    stellarAddress,
    evmAddress,
    version,
    stellarSignature,
    evmSignature,
  });
}

describe("StellarListener event parsing and cursor safety", () => {
  function listener(server, extra = {}) {
    return new StellarListener({
      complianceContractId: CONTRACT_ID,
      server,
      cursorFile: null,
      pollIntervalMs: 100_000,
      ...extra,
    });
  }

  it("decodes a well-formed attestation event (string or Contract instance)", () => {
    const parsed = listener({})._parseEvent(makeEvent());
    expect(parsed).not.toBeNull();
    expect(parsed.policy).toBe("defi_pool");
    expect(parsed.compliant).toBe(true);
    expect(parsed.ledger).toBe(100);
    expect(parsed.id).toBe("0000000100-0000000001");

    const fromContractObj = listener({})._parseEvent(
      makeEvent({ contractId: new Contract(CONTRACT_ID) })
    );
    expect(fromContractObj).not.toBeNull();
    expect(fromContractObj.contractId).toBe(CONTRACT_ID);
  });

  it("drops events from another contract, wrong topic, or invalid types", () => {
    expect(
      listener({})._parseEvent(
        makeEvent({ contractId: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" })
      )
    ).toBeNull();

    const wrongTopic = makeEvent();
    wrongTopic.topic = [
      nativeToScVal("other", { type: "symbol" }),
      nativeToScVal("attestation", { type: "symbol" }),
    ];
    expect(listener({})._parseEvent(wrongTopic)).toBeNull();

    const wrongType = makeEvent();
    wrongType.value = xdr.ScVal.scvVec([
      nativeToScVal(Keypair.random().publicKey(), { type: "address" }),
      nativeToScVal("defi_pool", { type: "symbol" }),
      nativeToScVal("true", { type: "string" }),
    ]);
    expect(listener({})._parseEvent(wrongType)).toBeNull();
    expect(listener({})._parseEvent(makeEvent({ ledger: 0 }))).toBeNull();
  });

  it("does not advance cursor when durable persistence fails or RPC is down", async () => {
    const server = {
      getEvents: async () => ({ events: [makeEvent()], cursor: "cursor-1" }),
      getLatestLedger: async () => ({ sequence: 100 }),
    };
    const l = listener(server, {
      onEventDurable: async () => {
        throw new Error("disk full");
      },
    });
    l._running = false;
    const errors = [];
    l.on("pollError", (e) => errors.push(e));

    await l._poll();

    expect(errors).toHaveLength(1);
    expect(l._cursor).toBeNull();
    expect(l._processedIds).toHaveLength(0);

    // RPC outage emits pollError without crashing or advancing cursor
    const rpcDown = listener({
      getEvents: async () => {
        throw new Error("503 RPC unavailable");
      },
      getLatestLedger: async () => ({ sequence: 100 }),
    });
    const rpcErrors = [];
    rpcDown.on("pollError", (e) => rpcErrors.push(e));
    await rpcDown._poll();
    expect(rpcErrors).toHaveLength(1);
    expect(rpcDown._cursor).toBeNull();
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

describe("IdentityRegistry (Stellar <-> EVM mapping)", () => {
  it("registers, resolves, rotates, and revokes authenticated mappings", async () => {
    const registry = new IdentityRegistry();
    const stellarKp = Keypair.random();
    const evm1 = ethers.Wallet.createRandom();
    const evm2 = ethers.Wallet.createRandom();

    await createLinkedIdentity(registry, stellarKp, evm1, 1);
    expect(registry.resolve(stellarKp.publicKey()).evmAddress).toBe(evm1.address);

    // Rotate to evm2 at v2
    await createLinkedIdentity(registry, stellarKp, evm2, 2);
    expect(registry.resolve(stellarKp.publicKey()).evmAddress).toBe(evm2.address);

    // Reject stale v1 replay
    const staleMsg = buildLinkMessage({
      stellarAddress: stellarKp.publicKey(),
      evmAddress: evm1.address,
      version: 1,
    });
    expect(() =>
      registry.registerMapping({
        stellarAddress: stellarKp.publicKey(),
        evmAddress: evm1.address,
        version: 1,
        stellarSignature: stellarKp.sign(Buffer.from(staleMsg, "utf8")).toString("base64"),
        evmSignature: "0x00",
      })
    ).toThrow(/Stale mapping version/);

    // Revoke mapping
    const revokeMsg = buildRevokeMessage({
      stellarAddress: stellarKp.publicKey(),
      version: 2,
    });
    registry.revokeMapping({
      stellarAddress: stellarKp.publicKey(),
      version: 2,
      stellarSignature: stellarKp.sign(Buffer.from(revokeMsg, "utf8")).toString("base64"),
    });
    expect(registry.resolve(stellarKp.publicKey())).toBeNull();
  });

  it("rejects unauthorized Stellar or EVM signatures", async () => {
    const registry = new IdentityRegistry();
    const victimStellar = Keypair.random();
    const attackerStellar = Keypair.random();
    const evmWallet = ethers.Wallet.createRandom();
    const otherEvm = ethers.Wallet.createRandom();

    const msg = buildLinkMessage({
      stellarAddress: victimStellar.publicKey(),
      evmAddress: evmWallet.address,
      version: 1,
    });

    // Forged Stellar signature
    expect(() =>
      registry.registerMapping({
        stellarAddress: victimStellar.publicKey(),
        evmAddress: evmWallet.address,
        version: 1,
        stellarSignature: attackerStellar.sign(Buffer.from(msg, "utf8")).toString("base64"),
        evmSignature: "0x00",
      })
    ).toThrow(/Invalid Stellar ownership signature/);

    // Forged EVM signature
    const validStellarSig = victimStellar.sign(Buffer.from(msg, "utf8")).toString("base64");
    const wrongEvmSig = await otherEvm.signMessage(msg);
    expect(() =>
      registry.registerMapping({
        stellarAddress: victimStellar.publicKey(),
        evmAddress: evmWallet.address,
        version: 1,
        stellarSignature: validStellarSig,
        evmSignature: wrongEvmSig,
      })
    ).toThrow(/does not match target EVM address/);
  });
});

describe("EVMRelayer and Durable ComplianceBridge", () => {
  const subjectEvm = ethers.Wallet.createRandom().address;

  function relayerWith(receipt, contractOverrides = {}) {
    const contract = {
      consumedNonce: jest.fn(async () => false),
      receiveAttestation: jest.fn(async () => ({
        hash: "0xabc",
        wait: async () => receipt,
      })),
      runner: { provider: { getNetwork: async () => ({ chainId: 11155111n }) } },
      getAddress: async () => "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      ...contractOverrides,
    };
    const wallet = { signTypedData: jest.fn(async () => "0xtypedsig") };
    return { relayer: new EVMRelayer({ contract, wallet }), contract, wallet };
  }

  const attestation = {
    id: "0000000100-0000000001",
    subject: subjectEvm,
    policy: "defi_pool",
    compliant: true,
    ledger: 100,
    expiresAt: 2_000_000_000,
  };

  it("signs EIP-712 typed data and confirms successful transactions", async () => {
    const { relayer, contract, wallet } = relayerWith({ status: 1, blockNumber: 777 });
    const result = await relayer.relay(attestation);

    expect(result.hash).toBe("0xabc");
    expect(result.blockNumber).toBe(777);
    expect(wallet.signTypedData).toHaveBeenCalledTimes(1);
    const sent = contract.receiveAttestation.mock.calls[0];
    expect(sent[0]).toBe(ethers.getAddress(subjectEvm));
    expect(sent[3]).toBe(100n);
    expect(sent[6]).toBe("0xtypedsig");
  });

  it("skips duplicate relay when nonce is already consumed on EVM", async () => {
    const { relayer, contract } = relayerWith(
      { status: 1 },
      { consumedNonce: jest.fn(async () => true) }
    );
    const result = await relayer.relay(attestation);
    expect(result.alreadyConfirmed).toBe(true);
    expect(contract.receiveAttestation).not.toHaveBeenCalled();
  });

  it("rejects reverted transactions, missing receipts, and unconfigured relayers", async () => {
    await expect(relayerWith({ status: 0 }).relayer.relay(attestation)).rejects.toThrow(
      /reverted/
    );
    await expect(relayerWith(null).relayer.relay(attestation)).rejects.toThrow(/reverted/);
    await expect(new EVMRelayer({}).relay(attestation)).rejects.toThrow(/not configured/);
  });

  it("retries failed relays with backoff, dead-letters unmapped subjects, and recovers on restart", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-test-"));
    const queueFile = path.join(tmpDir, "queue.json");
    const cursorFile = path.join(tmpDir, "cursor.json");
    const identityFile = path.join(tmpDir, "identities.json");

    const stellarKp = Keypair.random();
    const evmWallet = ethers.Wallet.createRandom();
    const registry = new IdentityRegistry({ storeFile: identityFile });
    await createLinkedIdentity(registry, stellarKp, evmWallet, 1);

    const mappedEvent = {
      id: "0000000200-0000000001",
      subject: stellarKp.publicKey(),
      policy: "defi_pool",
      compliant: true,
      ledger: 200,
      contractId: CONTRACT_ID,
    };
    const unmappedEvent = {
      id: "0000000201-0000000001",
      subject: Keypair.random().publicKey(),
      policy: "defi_pool",
      compliant: true,
      ledger: 201,
      contractId: CONTRACT_ID,
    };

    const queue = new EventQueue({ queueFile, maxRetries: 2, baseDelayMs: 10 });
    queue.enqueue(mappedEvent);
    queue.enqueue(unmappedEvent);

    // Simulate crash while mappedEvent was `processing`, then restart
    queue.markProcessing(mappedEvent.id);
    const recoveredQueue = new EventQueue({ queueFile, maxRetries: 2, baseDelayMs: 10 });
    expect(recoveredQueue.get(mappedEvent.id).state).toBe(STATES.PENDING);

    const relayer = {
      relay: jest
        .fn()
        .mockRejectedValueOnce(new Error("EVM RPC timeout"))
        .mockResolvedValueOnce({ hash: "0xconfirmed", blockNumber: 901 }),
    };

    const listener = new StellarListener({
      complianceContractId: CONTRACT_ID,
      server: {
        getEvents: async () => ({ events: [] }),
        getLatestLedger: async () => ({ sequence: 200 }),
      },
      cursorFile,
    });

    const bridge = new ComplianceBridge({
      listener,
      relayer,
      identityRegistry: registry,
      eventQueue: recoveredQueue,
    });

    // Pass 1: mappedEvent hits transient error -> retrying; unmappedEvent -> failed (dead-letter)
    await bridge.processPending(Date.now());
    expect(recoveredQueue.get(mappedEvent.id).state).toBe(STATES.RETRYING);
    expect(recoveredQueue.get(unmappedEvent.id).state).toBe(STATES.FAILED);

    // Pass 2 after backoff window: mappedEvent confirms
    await bridge.processPending(Date.now() + 100);
    expect(recoveredQueue.get(mappedEvent.id).state).toBe(STATES.CONFIRMED);
    expect(recoveredQueue.get(mappedEvent.id).txHash).toBe("0xconfirmed");

    // Duplicate enqueue is ignored
    const dup = recoveredQueue.enqueue(mappedEvent);
    expect(dup.inserted).toBe(false);
    expect(dup.record.state).toBe(STATES.CONFIRMED);

    // Operator links unmapped subject and manually retries dead-letter item
    const unmappedKp = Keypair.random();
    const event3 = { ...unmappedEvent, id: "0000000202-0000000001", subject: unmappedKp.publicKey() };
    recoveredQueue.enqueue(event3);
    await bridge.processPending(Date.now());
    expect(recoveredQueue.get(event3.id).state).toBe(STATES.FAILED);

    await createLinkedIdentity(registry, unmappedKp, evmWallet, 1);
    relayer.relay.mockResolvedValueOnce({ hash: "0xretried", blockNumber: 902 });
    await bridge.retryDeadLetter(event3.id);
    expect(recoveredQueue.get(event3.id).state).toBe(STATES.CONFIRMED);
    expect(recoveredQueue.get(event3.id).txHash).toBe("0xretried");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
