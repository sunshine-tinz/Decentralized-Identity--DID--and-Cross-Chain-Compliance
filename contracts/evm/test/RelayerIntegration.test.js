"use strict";

const { expect } = require("chai");
const { ethers } = require("hardhat");

// The real bridge relayer, not a reimplementation of its digest.
const { EVMRelayer } = require("../../../services/cross-chain-bridge/src/lib/evmRelayer");

const SUBJECT = "G" + "A".repeat(55);
const EVENT_ID = "0000000100-0000000001";

async function deployReceiver() {
  const [owner] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const factory = await ethers.getContractFactory("AttestationReceiver");
  const receiver = await factory.deploy(owner.address, network.chainId);
  await receiver.waitForDeployment();
  return receiver;
}

function attestation(overrides = {}) {
  return {
    id: EVENT_ID,
    subject: SUBJECT,
    policy: "defi_pool",
    compliant: true,
    ledger: 100,
    ...overrides,
  };
}

describe("Relayer ↔ AttestationReceiver integration", () => {
  it("accepts an attestation signed by the JavaScript relayer", async () => {
    const receiver = await deployReceiver();
    const signer = ethers.Wallet.createRandom(); // signs only; owner sends the tx
    await receiver.setRelayer(signer.address, true);

    const relayer = new EVMRelayer({ contract: receiver, wallet: signer });
    expect(relayer.enabled).to.equal(true);

    const txHash = await relayer.relay(attestation());
    expect(txHash).to.match(/^0x[0-9a-f]{64}$/);

    const nonce = ethers.keccak256(ethers.toUtf8Bytes(EVENT_ID));
    expect(await receiver.consumedNonce(nonce)).to.equal(true);
  });

  it("rejects a relayer that the contract has not allowlisted", async () => {
    const receiver = await deployReceiver();
    const signer = ethers.Wallet.createRandom();
    // Deliberately not allowlisted.
    const relayer = new EVMRelayer({ contract: receiver, wallet: signer });

    let error;
    try {
      await relayer.relay(attestation());
    } catch (err) {
      error = err;
    }
    expect(error, "relay should fail for a non-allowlisted signer").to.be.instanceOf(Error);
    expect(error.message).to.match(/revert/i);

    const nonce = ethers.keccak256(ethers.toUtf8Bytes(EVENT_ID));
    expect(await receiver.consumedNonce(nonce)).to.equal(false);
  });
});
