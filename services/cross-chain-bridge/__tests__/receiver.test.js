"use strict";

/**
 * JavaScript EIP-712 helper and ABI compatibility tests for AttestationReceiver.
 *
 * NOTE: These tests verify JavaScript signing/ABI alignment only. Actual Solidity
 * bytecode execution, signature recovery, replay rejection, and expiration are
 * tested in Foundry (`contracts/evm/test/AttestationReceiver.t.sol`).
 */

const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");
const {
  RECEIVER_ABI,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  ATTESTATION_TYPES,
} = require("../src/lib/evmRelayer");

describe("AttestationReceiver ABI and EIP-712 Helper Alignment", () => {
  let artifact;
  let relayerWallet;
  let unauthorizedWallet;
  let destinationContractAddress;
  let otherContractAddress;
  const chainId = 11155111n;

  beforeAll(() => {
    const solPath = path.resolve(__dirname, "../../../contracts/evm/AttestationReceiver.sol");
    const source = fs.readFileSync(solPath, "utf8");

    const input = {
      language: "Solidity",
      sources: {
        "AttestationReceiver.sol": { content: source },
      },
      settings: {
        outputSelection: {
          "*": {
            "*": ["abi", "evm.bytecode"],
          },
        },
      },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    expect(output.errors ? output.errors.filter((e) => e.severity === "error") : []).toHaveLength(
      0
    );

    const contract = output.contracts["AttestationReceiver.sol"]["AttestationReceiver"];
    artifact = {
      abi: contract.abi,
      bytecode: "0x" + contract.evm.bytecode.object,
    };

    relayerWallet = ethers.Wallet.createRandom();
    unauthorizedWallet = ethers.Wallet.createRandom();
    destinationContractAddress = ethers.Wallet.createRandom().address;
    otherContractAddress = ethers.Wallet.createRandom().address;
  });

  it("compiles AttestationReceiver.sol and exposes updated RECEIVER_ABI methods", () => {
    expect(artifact.bytecode.length).toBeGreaterThan(100);

    const iface = new ethers.Interface(artifact.abi);
    expect(iface.getFunction("receiveAttestation")).toBeDefined();
    expect(iface.getFunction("revokeAttestation")).toBeDefined();
    expect(iface.getFunction("rotateRelayer")).toBeDefined();
    expect(iface.getFunction("acceptOwnership")).toBeDefined();
    expect(iface.getFunction("consumedNonce")).toBeDefined();
    expect(iface.getFunction("isCompliant")).toBeDefined();
    expect(RECEIVER_ABI.length).toBeGreaterThan(0);
  });

  it("recovers the authorized relayer from an EIP-712 typed-data signature", async () => {
    const domain = {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract: destinationContractAddress,
    };
    const message = {
      subject: ethers.Wallet.createRandom().address,
      policy: "defi_pool",
      compliant: true,
      stellarLedger: 100n,
      expiresAt: 2_000_000_000n,
      nonce: ethers.keccak256(ethers.toUtf8Bytes("0000000100-0000000001")),
    };

    const sig = await relayerWallet.signTypedData(domain, ATTESTATION_TYPES, message);
    const recovered = ethers.verifyTypedData(domain, ATTESTATION_TYPES, message, sig);
    expect(recovered.toLowerCase()).toBe(relayerWallet.address.toLowerCase());
  });

  it("breaks EIP-712 verification on payload alteration, wrong chainId, wrong contract, or wrong signer", async () => {
    const domain = {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract: destinationContractAddress,
    };
    const message = {
      subject: ethers.Wallet.createRandom().address,
      policy: "defi_pool",
      compliant: true,
      stellarLedger: 100n,
      expiresAt: 2_000_000_000n,
      nonce: ethers.keccak256(ethers.toUtf8Bytes("event-102")),
    };

    const sig = await relayerWallet.signTypedData(domain, ATTESTATION_TYPES, message);

    const tamperedRecovered = ethers.verifyTypedData(
      domain,
      ATTESTATION_TYPES,
      { ...message, compliant: false },
      sig
    );
    expect(tamperedRecovered.toLowerCase()).not.toBe(relayerWallet.address.toLowerCase());

    const wrongChainRecovered = ethers.verifyTypedData(
      { ...domain, chainId: 1n },
      ATTESTATION_TYPES,
      message,
      sig
    );
    expect(wrongChainRecovered.toLowerCase()).not.toBe(relayerWallet.address.toLowerCase());

    const wrongContractRecovered = ethers.verifyTypedData(
      { ...domain, verifyingContract: otherContractAddress },
      ATTESTATION_TYPES,
      message,
      sig
    );
    expect(wrongContractRecovered.toLowerCase()).not.toBe(relayerWallet.address.toLowerCase());

    const unauthorizedSig = await unauthorizedWallet.signTypedData(
      domain,
      ATTESTATION_TYPES,
      message
    );
    const unauthorizedRecovered = ethers.verifyTypedData(
      domain,
      ATTESTATION_TYPES,
      message,
      unauthorizedSig
    );
    expect(unauthorizedRecovered.toLowerCase()).toBe(unauthorizedWallet.address.toLowerCase());
  });
});
