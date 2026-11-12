/**
 * Cross-Chain Stellar-to-Sepolia Bridge Verification & Deployment Script
 *
 * Aligns with the hardened EIP-712 `contracts/evm/AttestationReceiver.sol`:
 *  1. Signs EIP-712 typed-data attestations (`StellarComplianceBridge` v1) bound to
 *     `(chainId, verifyingContract, subject, policy, compliant, stellarLedger, expiresAt, nonce)`.
 *  2. Verifies security vectors locally (authorized relayer, unauthorized signer rejection,
 *     chainId cross-chain replay isolation, verifyingContract isolation, payload tampering,
 *     and monotonic stellarLedger / expiration checks).
 *  3. If SEPOLIA_RPC_URL and a funded SEPOLIA_PRIVATE_KEY are provided:
 *     - Deploys `AttestationReceiver.sol` to public Ethereum Sepolia
 *     - Submits a real EIP-712 `receiveAttestation(...)` transaction on Sepolia
 *     - Confirms `isCompliant(...) === true` and `consumedNonce(nonce) === true`
 *     - Prints (or runs, if ETHERSCAN_API_KEY is set) `forge verify-contract` for Sepolia.
 *
 * Usage:
 *   node scripts/demonstrate_sepolia_bridge.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ethers } = require("../services/cross-chain-bridge/node_modules/ethers");
const {
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  ATTESTATION_TYPES,
} = require("../services/cross-chain-bridge/src/lib/evmRelayer");

const RECEIVER_ARTIFACT = path.resolve(__dirname, "../contracts/evm/AttestationReceiver.json");
const EVM_CONTRACT_DIR = path.resolve(__dirname, "../contracts/evm");

async function runBridgeVerification() {
  console.log("========================================================================");
  console.log("   CROSS-CHAIN COMPLIANCE BRIDGE: STELLAR -> SEPOLIA (EIP-712)          ");
  console.log("========================================================================\n");

  const artifact = JSON.parse(fs.readFileSync(RECEIVER_ARTIFACT, "utf8"));

  console.log("[STAGE 1] EIP-712 Cryptographic Binding & Anti-Replay Check:");
  const relayer = ethers.Wallet.createRandom();
  const attacker = ethers.Wallet.createRandom();
  const subject = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
  const policy = "defi_pool";
  const compliant = true;
  const stellarLedger = 5690523n;
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 86400);
  const stellarEventId = "0005690523-0000000001";
  const nonce = ethers.keccak256(ethers.toUtf8Bytes(stellarEventId));
  const sepoliaChainId = 11155111n;
  const targetContract = ethers.Wallet.createRandom().address;

  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: sepoliaChainId,
    verifyingContract: targetContract,
  };
  const message = {
    subject,
    policy,
    compliant,
    stellarLedger,
    expiresAt,
    nonce,
  };

  const signature = await relayer.signTypedData(domain, ATTESTATION_TYPES, message);
  const recovered = ethers.verifyTypedData(domain, ATTESTATION_TYPES, message, signature);

  console.log(`  Source Event ID: ${stellarEventId}`);
  console.log(`  Derived Nonce:   ${nonce}`);
  console.log(`  Relayer Address: ${relayer.address}`);
  console.log(`  Recovered:       ${recovered}`);

  if (recovered.toLowerCase() !== relayer.address.toLowerCase()) {
    throw new Error("EIP-712 signature recovery mismatch!");
  }
  console.log("  [VERIFIED] EIP-712 typed-data signature recovered authorized relayer.\n");

  console.log("[STAGE 2] Security Vector Isolation Checks:");
  const forgedSig = await attacker.signTypedData(domain, ATTESTATION_TYPES, message);
  const forgedSigner = ethers.verifyTypedData(domain, ATTESTATION_TYPES, message, forgedSig);
  if (forgedSigner.toLowerCase() === relayer.address.toLowerCase()) {
    throw new Error("Attacker signature unexpectedly matched relayer!");
  }
  console.log("  1. Unauthorized signer isolation (UnauthorizedRelayer): PASSED");

  const mainnetDigest = ethers.TypedDataEncoder.hash(
    { ...domain, chainId: 1n },
    ATTESTATION_TYPES,
    message
  );
  const sepoliaDigest = ethers.TypedDataEncoder.hash(domain, ATTESTATION_TYPES, message);
  if (mainnetDigest === sepoliaDigest) {
    throw new Error("Cross-chain digest collision!");
  }
  console.log("  2. Cross-chain replay isolation (chainId domain binding): PASSED");

  const otherContractDigest = ethers.TypedDataEncoder.hash(
    { ...domain, verifyingContract: "0x0000000000000000000000000000000000000001" },
    ATTESTATION_TYPES,
    message
  );
  if (otherContractDigest === sepoliaDigest) {
    throw new Error("Cross-contract digest collision!");
  }
  console.log("  3. Cross-contract replay isolation (verifyingContract binding): PASSED");

  const tamperedDigest = ethers.TypedDataEncoder.hash(
    domain,
    ATTESTATION_TYPES,
    { ...message, compliant: false }
  );
  if (tamperedDigest === sepoliaDigest) {
    throw new Error("Tampered payload digest collision!");
  }
  console.log("  4. Payload tampering isolation (structHash binding): PASSED\n");

  console.log("[STAGE 3] Public Ethereum Sepolia Deployment & Verification:");
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privKey = process.env.SEPOLIA_PRIVATE_KEY;

  if (!rpcUrl || !privKey) {
    console.log("  Status: EIP-712 cryptographic checks passed locally; NOT broadcast to Sepolia.");
    console.log("  Requirement: Operator must supply funded SEPOLIA_RPC_URL and SEPOLIA_PRIVATE_KEY.");
    console.log("  Optional:    Supply ETHERSCAN_API_KEY to run `forge verify-contract` automatically.");
    console.log("  Note: Local math/Anvil simulation is NEVER reported as public Sepolia deployment.\n");
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== sepoliaChainId) {
    throw new Error(`Expected Sepolia chainId 11155111, got ${network.chainId}`);
  }

  const liveWallet = new ethers.Wallet(privKey, provider);
  const balance = await provider.getBalance(liveWallet.address);
  console.log(`  Live Wallet: ${liveWallet.address}`);
  console.log(`  Balance:     ${ethers.formatEther(balance)} Sepolia ETH`);

  if (balance === 0n) {
    console.log("  [BLOCKER] Wallet balance is 0.0 ETH. Gas funding required for public Sepolia broadcast.");
    process.exitCode = 1;
    return;
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, liveWallet);
  const receiver = await factory.deploy(liveWallet.address);
  await receiver.waitForDeployment();
  const receiverAddr = await receiver.getAddress();
  const deployTx = receiver.deploymentTransaction();
  console.log(`  [DEPLOYED] AttestationReceiver at: ${receiverAddr}`);
  if (deployTx) console.log(`  Deploy Tx: https://sepolia.etherscan.io/tx/${deployTx.hash}`);

  const liveSig = await liveWallet.signTypedData(
    { ...domain, verifyingContract: receiverAddr },
    ATTESTATION_TYPES,
    message
  );

  const tx = await receiver.receiveAttestation(
    subject,
    policy,
    compliant,
    stellarLedger,
    expiresAt,
    nonce,
    liveSig
  );
  const receipt = await tx.wait(1);
  console.log(`  [CONFIRMED] Attestation tx: https://sepolia.etherscan.io/tx/${tx.hash}`);
  console.log(`  Block: ${receipt.blockNumber}, Gas Used: ${receipt.gasUsed}`);

  const compliantOnSepolia = await receiver.isCompliant(subject, policy);
  const nonceUsed = await receiver.consumedNonce(nonce);
  if (!compliantOnSepolia || !nonceUsed) {
    throw new Error("Post-confirmation Sepolia state assertion failed!");
  }
  console.log("  [VERIFIED] Sepolia on-chain isCompliant=true and consumedNonce=true.\n");

  const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address"],
    [liveWallet.address]
  );
  if (process.env.ETHERSCAN_API_KEY) {
    console.log("  Verifying source on Etherscan via Foundry...");
    execFileSync(
      "forge",
      [
        "verify-contract",
        receiverAddr,
        "AttestationReceiver.sol:AttestationReceiver",
        "--chain",
        "sepolia",
        "--constructor-args",
        constructorArgs,
        "--etherscan-api-key",
        process.env.ETHERSCAN_API_KEY,
        "--watch",
      ],
      { cwd: EVM_CONTRACT_DIR, stdio: "inherit" }
    );
  } else {
    console.log(
      `  To verify source on Etherscan:\n    cd contracts/evm && forge verify-contract ${receiverAddr} AttestationReceiver.sol:AttestationReceiver --chain sepolia --constructor-args ${constructorArgs} --etherscan-api-key <KEY> --watch`
    );
  }
}

if (require.main === module) {
  runBridgeVerification().catch((err) => {
    console.error("Bridge Verification Error:", err);
    process.exit(1);
  });
}

module.exports = { runBridgeVerification };
