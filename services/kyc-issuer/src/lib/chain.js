/**
 * Soroban submission for issuer-attested credentials.
 *
 * Approval writes one `issue_credential(issuer, subject, attribute, expires_at)`
 * invocation per requested attribute to the VC Verifier contract. The issuer
 * address and key come from the server environment; no key material is accepted
 * over HTTP.
 *
 * Configuration (all required to enable on-chain issuance):
 *   SOROBAN_RPC_URL, NETWORK_PASSPHRASE, VC_VERIFIER_CONTRACT_ID, ISSUER_SECRET_KEY
 *
 * `ISSUER_SECRET_KEY` must belong to an address registered on-chain via
 * `VCVerifier.add_issuer`; otherwise every submission fails and the request
 * stays pending.
 */

"use strict";

const {
  Address,
  Contract,
  Keypair,
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
} = require("@stellar/stellar-sdk");

const DEFAULT_TTL_LEDGERS = 518_400; // ~30 days at 5 s/ledger
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 45_000;

/**
 * Read and validate chain configuration. Returns null when on-chain issuance is
 * not configured (or the secret is malformed), so callers can fail closed.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{rpcUrl: string, networkPassphrase: string, contractId: string,
 *            keypair: import("@stellar/stellar-sdk").Keypair, address: string,
 *            ttlLedgers: number} | null}
 */
function loadChainConfig(env = process.env) {
  const rpcUrl = env.SOROBAN_RPC_URL;
  const networkPassphrase = env.NETWORK_PASSPHRASE;
  const contractId = env.VC_VERIFIER_CONTRACT_ID;
  const secret = env.ISSUER_SECRET_KEY;
  if (!rpcUrl || !networkPassphrase || !contractId || !secret) return null;

  let keypair;
  try {
    keypair = Keypair.fromSecret(secret.trim());
  } catch {
    return null;
  }

  const ttl = Number.parseInt(env.CREDENTIAL_TTL_LEDGERS || "", 10);
  const ttlLedgers = Number.isFinite(ttl) && ttl > 0 && ttl <= 6_312_000 ? ttl : DEFAULT_TTL_LEDGERS;

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
  return new SorobanRpc.Server(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://"),
  });
}

/**
 * Ledger sequence at which credentials issued now should expire.
 *
 * @param {object} config
 * @returns {Promise<number>}
 */
async function credentialExpiryLedger(config, server = serverFor(config)) {
  const latest = await server.getLatestLedger();
  return Number(latest.sequence) + config.ttlLedgers;
}

/**
 * Submit one `issue_credential` call and wait for a final result.
 *
 * @param {object} config
 * @param {{subject: string, attribute: string, expiresAt: number}} params
 * @returns {Promise<{hash: string, ledger: number}>}
 */
async function issueCredential(config, { subject, attribute, expiresAt }) {
  const server = serverFor(config);
  const source = await server.getAccount(config.address);
  const contract = new Contract(config.contractId);

  const tx = new TransactionBuilder(source, {
    fee: "1000000",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "issue_credential",
        new Address(config.address).toScVal(),
        new Address(subject).toScVal(),
        nativeToScVal(attribute, { type: "symbol" }),
        nativeToScVal(expiresAt, { type: "u32" })
      )
    )
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

  const result = await pollTransaction(server, sent.hash);
  if (result.status !== "SUCCESS") {
    throw new Error(`credential transaction ${sent.hash} did not succeed`);
  }

  return { hash: sent.hash, ledger: Number(result.ledger) };
}

async function pollTransaction(server, hash) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash);
    if (result.status !== "NOT_FOUND") return result;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`timed out waiting for transaction ${hash}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { loadChainConfig, issueCredential, credentialExpiryLedger };
