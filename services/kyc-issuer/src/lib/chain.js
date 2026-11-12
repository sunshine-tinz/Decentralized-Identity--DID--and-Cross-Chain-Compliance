/**
 * Soroban submission for issuer-attested credentials.
 *
 * Approval writes one `issue_credential(issuer, subject, attribute, expires_at)`
 * invocation per requested attribute to the VC Verifier contract, and supports
 * compensating `revoke_credential` rollback if a multi-attribute batch fails.
 */

"use strict";

const {
  Address,
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} = require("@stellar/stellar-sdk");

const DEFAULT_TTL_LEDGERS = 518_400; // ~30 days at 5 s/ledger
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 45_000;

function parseSecretKeyMap(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const part of String(raw).split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const idx = entry.indexOf(":");
    if (idx <= 0) continue;
    const pub = entry.slice(0, idx).trim();
    const sec = entry.slice(idx + 1).trim();
    if (StrKey.isValidEd25519PublicKey(pub) && sec) {
      map.set(pub, sec);
    }
  }
  return map;
}

/**
 * Read and validate chain configuration. Fails closed when missing or when
 * `expectedIssuerId` (a Stellar G... address) does not match the signing key.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [expectedIssuerId]
 */
function loadChainConfig(env = process.env, expectedIssuerId = null) {
  const rpcUrl = env.SOROBAN_RPC_URL;
  const networkPassphrase = env.NETWORK_PASSPHRASE;
  const contractId = env.VC_VERIFIER_CONTRACT_ID;

  let secret = env.ISSUER_SECRET_KEY;
  if (expectedIssuerId && StrKey.isValidEd25519PublicKey(expectedIssuerId) && env.ISSUER_SECRET_KEYS) {
    const secretMap = parseSecretKeyMap(env.ISSUER_SECRET_KEYS);
    if (secretMap.has(expectedIssuerId)) {
      secret = secretMap.get(expectedIssuerId);
    }
  }

  if (!rpcUrl || !networkPassphrase || !contractId || !secret) return null;

  let keypair;
  try {
    keypair = Keypair.fromSecret(secret.trim());
  } catch {
    return null;
  }

  // Prevent silent divergence between authenticated issuer and on-chain signer.
  if (
    expectedIssuerId &&
    StrKey.isValidEd25519PublicKey(expectedIssuerId) &&
    keypair.publicKey() !== expectedIssuerId
  ) {
    throw new Error("Authenticated issuer identity does not match on-chain signing key");
  }

  const ttl = Number.parseInt(env.CREDENTIAL_TTL_LEDGERS || "", 10);
  const ttlLedgers =
    Number.isFinite(ttl) && ttl > 0 && ttl <= 6_312_000 ? ttl : DEFAULT_TTL_LEDGERS;

  return {
    rpcUrl,
    networkPassphrase,
    contractId,
    keypair,
    address: keypair.publicKey(),
    ttlLedgers,
  };
}

function serverFor(config) {
  return new rpc.Server(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://"),
  });
}

async function credentialExpiryLedger(config, server = serverFor(config)) {
  const latest = await server.getLatestLedger();
  return Number(latest.sequence) + config.ttlLedgers;
}

async function submitContractCall(config, method, args) {
  const server = serverFor(config);
  const source = await server.getAccount(config.address);
  const contract = new Contract(config.contractId);

  const tx = new TransactionBuilder(source, {
    fee: "1000000",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(config.keypair);

  let sent = await server.sendTransaction(prepared);
  for (let attempt = 0; sent.status === "TRY_AGAIN_LATER" && attempt < 3; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);
    sent = await server.sendTransaction(prepared);
  }
  if (sent.status === "ERROR" || !sent.hash) {
    throw new Error("Soroban RPC rejected the transaction");
  }

  const result = await pollTransaction(server, sent.hash, config.rpcUrl);
  if (result.status !== "SUCCESS") {
    throw new Error(`credential transaction ${sent.hash} did not succeed`);
  }

  return { hash: sent.hash, ledger: Number(result.ledger) };
}

async function issueCredential(config, { subject, attribute, expiresAt }) {
  return submitContractCall(config, "issue_credential", [
    new Address(config.address).toScVal(),
    new Address(subject).toScVal(),
    nativeToScVal(attribute, { type: "symbol" }),
    nativeToScVal(expiresAt, { type: "u32" }),
  ]);
}

async function revokeCredential(config, { subject, attribute }) {
  return submitContractCall(config, "revoke_credential", [
    new Address(config.address).toScVal(),
    new Address(subject).toScVal(),
    nativeToScVal(attribute, { type: "symbol" }),
  ]);
}

async function getTransactionSafe(server, rpcUrl, hash) {
  try {
    return await server.getTransaction(hash);
  } catch (err) {
    if (String(err && err.message).includes("Bad union switch") && rpcUrl) {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: { hash },
        }),
      });
      const json = await res.json();
      if (json && json.result) return json.result;
    }
    throw err;
  }
}

async function pollTransaction(server, hash, rpcUrl) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await getTransactionSafe(server, rpcUrl, hash);
    if (result.status !== "NOT_FOUND") return result;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`timed out waiting for transaction ${hash}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  loadChainConfig,
  issueCredential,
  revokeCredential,
  credentialExpiryLedger,
};
