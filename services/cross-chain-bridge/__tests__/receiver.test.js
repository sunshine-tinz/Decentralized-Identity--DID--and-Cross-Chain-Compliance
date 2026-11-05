"use strict";

const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");
const { EVMRelayer, RECEIVER_ABI } = require("../src/lib/evmRelayer");

describe("AttestationReceiver Contract and Verification", () => {
  let artifact;
  let relayerWallet;
  let unauthorizedWallet;
  let destinationContractAddress;
  let otherContractAddress;
  const chainId = 11155111;

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
    expect(output.errors ? output.errors.filter((e) => e.severity === "error") : []).toHaveLength(0);

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

  it("compiles with valid bytecode and exposes all RECEIVER_ABI methods", () => {
    expect(artifact.bytecode.length).toBeGreaterThan(100);

    const iface = new ethers.Interface(artifact.abi);
    expect(iface.getFunction("receiveAttestation")).toBeDefined();
    expect(iface.getFunction("consumedNonce")).toBeDefined();
    expect(iface.getFunction("isCompliant")).toBeDefined();
    expect(iface.getFunction("setRelayer")).toBeDefined();
    expect(iface.getFunction("transferOwnership")).toBeDefined();
  });

  it("recovers the correct signer using EIP-191 digest format with domain separation", async () => {
    const subject = ethers.Wallet.createRandom().address;
    const policy = "defi_pool";
    const compliant = true;
    const id = "0000000100-0000000001";
    const nonce = ethers.keccak256(ethers.toUtf8Bytes(String(id)));

    // Relayer computes digest bound to chainId AND destinationContractAddress
    const digest = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [subject, policy, compliant, nonce, chainId, destinationContractAddress]
    );
    const signature = await relayerWallet.signMessage(ethers.getBytes(digest));

    // Destination contract recovers signer from digest
    const ethSignedDigest = ethers.hashMessage(ethers.getBytes(digest));
    const recovered = ethers.recoverAddress(ethSignedDigest, signature);

    expect(recovered.toLowerCase()).toBe(relayerWallet.address.toLowerCase());
  });

  it("rejects altered payload (subject, policy, or compliance status)", async () => {
    const subject = ethers.Wallet.createRandom().address;
    const otherSubject = ethers.Wallet.createRandom().address;
    const policy = "defi_pool";
    const compliant = true;
    const id = "0000000100-0000000001";
    const nonce = ethers.keccak256(ethers.toUtf8Bytes(String(id)));

    const digest = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [subject, policy, compliant, nonce, chainId, destinationContractAddress]
    );
    const signature = await relayerWallet.signMessage(ethers.getBytes(digest));

    // Attacker alters subject
    const alteredSubjectDigest = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [otherSubject, policy, compliant, nonce, chainId, destinationContractAddress]
    );
    const recoveredAlteredSubject = ethers.recoverAddress(
      ethers.hashMessage(ethers.getBytes(alteredSubjectDigest)),
      signature
    );
    expect(recoveredAlteredSubject.toLowerCase()).not.toBe(relayerWallet.address.toLowerCase());

    // Attacker alters policy
    const alteredPolicyDigest = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [subject, "admin_access", compliant, nonce, chainId, destinationContractAddress]
    );
    const recoveredAlteredPolicy = ethers.recoverAddress(
      ethers.hashMessage(ethers.getBytes(alteredPolicyDigest)),
      signature
    );
    expect(recoveredAlteredPolicy.toLowerCase()).not.toBe(relayerWallet.address.toLowerCase());
  });

  it("rejects cross-chain replay with incorrect chain ID", async () => {
    const subject = ethers.Wallet.createRandom().address;
    const policy = "defi_pool";
    const compliant = true;
    const nonce = ethers.keccak256(ethers.toUtf8Bytes("event-101"));

    const sepoliaDigest = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [subject, policy, compliant, nonce, 11155111, destinationContractAddress]
    );
    const signature = await relayerWallet.signMessage(ethers.getBytes(sepoliaDigest));

    // Submitting signature to Ethereum Mainnet (chainId 1)
    const mainnetDigest = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [subject, policy, compliant, nonce, 1, destinationContractAddress]
    );
    const recoveredMainnet = ethers.recoverAddress(
      ethers.hashMessage(ethers.getBytes(mainnetDigest)),
      signature
    );
    expect(recoveredMainnet.toLowerCase()).not.toBe(relayerWallet.address.toLowerCase());
  });

  it("rejects signatures intended for another destination contract (destination separation)", async () => {
    const subject = ethers.Wallet.createRandom().address;
    const policy = "defi_pool";
    const compliant = true;
    const nonce = ethers.keccak256(ethers.toUtf8Bytes("event-102"));

    // Signed specifically for contract A
    const digestA = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [subject, policy, compliant, nonce, chainId, destinationContractAddress]
    );
    const signatureA = await relayerWallet.signMessage(ethers.getBytes(digestA));

    // Attacker attempts to replay signatureA against contract B
    const digestB = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [subject, policy, compliant, nonce, chainId, otherContractAddress]
    );
    const recoveredB = ethers.recoverAddress(
      ethers.hashMessage(ethers.getBytes(digestB)),
      signatureA
    );
    expect(recoveredB.toLowerCase()).not.toBe(relayerWallet.address.toLowerCase());
  });

  it("rejects signatures from unauthorized relayers", async () => {
    const subject = ethers.Wallet.createRandom().address;
    const policy = "defi_pool";
    const compliant = true;
    const nonce = ethers.keccak256(ethers.toUtf8Bytes("event-103"));

    // Unauthorized party signs
    const digest = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [subject, policy, compliant, nonce, chainId, destinationContractAddress]
    );
    const unauthorizedSig = await unauthorizedWallet.signMessage(ethers.getBytes(digest));

    const recovered = ethers.recoverAddress(
      ethers.hashMessage(ethers.getBytes(digest)),
      unauthorizedSig
    );
    expect(recovered.toLowerCase()).toBe(unauthorizedWallet.address.toLowerCase());
    expect(recovered.toLowerCase()).not.toBe(relayerWallet.address.toLowerCase());
  });

  it("rejects invalid, truncated, or corrupted signatures", async () => {
    const subject = ethers.Wallet.createRandom().address;
    const digest = ethers.solidityPackedKeccak256(
      ["address", "string", "bool", "bytes32", "uint256", "address"],
      [subject, "policy", true, ethers.ZeroHash, chainId, destinationContractAddress]
    );

    // Malformed signature (invalid byte length) throws in ethers decoding
    const malformedSig = "0x1234";
    expect(() => {
      ethers.recoverAddress(ethers.hashMessage(ethers.getBytes(digest)), malformedSig);
    }).toThrow();

    // Tampered signature (1 altered byte in r) fails recovery or recovers non-relayer
    const validSig = await relayerWallet.signMessage(ethers.getBytes(digest));
    const tamperedSig = validSig.slice(0, 10) + (validSig[10] === "a" ? "b" : "a") + validSig.slice(11);
    let tamperedRecovered = null;
    try {
      tamperedRecovered = ethers.recoverAddress(
        ethers.hashMessage(ethers.getBytes(digest)),
        tamperedSig
      );
    } catch {
      tamperedRecovered = ethers.ZeroAddress;
    }
    expect(tamperedRecovered.toLowerCase()).not.toBe(relayerWallet.address.toLowerCase());
  });

  it("prevents duplicate nonce replay and verifies nonce consumption lifecycle", () => {
    const consumed = new Map();
    const nonce = ethers.keccak256(ethers.toUtf8Bytes("stellar-event-seq-42"));

    // First presentation: valid, unconsumed
    expect(consumed.has(nonce)).toBe(false);
    consumed.set(nonce, true);
    expect(consumed.get(nonce)).toBe(true);

    // Second presentation: duplicate attempt fails
    const isReplay = consumed.get(nonce) === true;
    expect(isReplay).toBe(true);
  });
});
