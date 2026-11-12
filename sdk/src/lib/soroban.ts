/**
 * Soroban RPC helpers.
 *
 * Reads are executed by simulation (no signature needed). Writes are *built and
 * prepared* but not signed: the returned XDR must be signed and submitted by the
 * caller, because the SDK never holds private keys.
 */

import {
  Account,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import {
  SorobanServerLike,
  StellarDIDConfig,
  SubmittedTransactionResult,
} from "../types";

/** A syntactically valid source account used for read-only simulation. */
const SIMULATION_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const BASE_FEE = "100";
const TIMEOUT_SECONDS = 60;

/**
 * @param config
 * @returns the configured RPC client, or a real one.
 */
export function getServer(config: StellarDIDConfig): SorobanServerLike {
  if (config.server) return config.server;
  return new rpc.Server(config.rpcUrl) as unknown as SorobanServerLike;
}

function buildTransaction(
  config: StellarDIDConfig,
  sourceAccount: Account,
  contractId: string,
  method: string,
  args: xdr.ScVal[]
) {
  const contract = new Contract(contractId);
  return new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TIMEOUT_SECONDS)
    .build();
}

/**
 * Execute a read-only contract call via simulation and decode its result.
 *
 * @throws if simulation fails or returns no result.
 */
export async function simulateRead(
  config: StellarDIDConfig,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<unknown> {
  const server = getServer(config);
  const source = new Account(config.publicKey ?? SIMULATION_SOURCE, "0");
  const tx = buildTransaction(config, source, contractId, method, args);

  const simulation = (await server.simulateTransaction(tx)) as {
    error?: string;
    result?: { retval: xdr.ScVal };
  };

  if (!simulation || simulation.error) {
    throw new Error(
      `Simulation of ${method} failed: ${simulation?.error ?? "unknown error"}`
    );
  }
  if (!simulation.result) {
    throw new Error(`Simulation of ${method} returned no result`);
  }

  return scValToNative(simulation.result.retval);
}

/**
 * Build and prepare an unsigned contract-invocation transaction.
 *
 * @returns base64 XDR of the prepared transaction, ready to be signed by the
 *          source account and submitted with `SorobanRpc.Server.sendTransaction`.
 * @throws if `config.publicKey` is not set.
 */
export async function buildPreparedTransaction(
  config: StellarDIDConfig,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<string> {
  if (!config.publicKey) {
    throw new Error(
      "config.publicKey is required to build a transaction (the SDK never holds a secret key)"
    );
  }

  const server = getServer(config);
  const account = (await server.getAccount(config.publicKey)) as Account;
  const tx = buildTransaction(config, account, contractId, method, args);

  // Explicitly simulate first so contract panics/auth errors surface before signing.
  const sim = (await server.simulateTransaction(tx)) as { error?: string } | undefined;
  if (sim?.error) {
    throw new Error(`Simulation of ${method} failed: ${sim.error}`);
  }

  const prepared = (await server.prepareTransaction(tx)) as { toXDR(): string };
  return prepared.toXDR();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate a signed transaction XDR, submit it to Soroban RPC, and poll until
 * finality (`SUCCESS` or `FAILED`).
 */
export async function submitSignedTransaction(
  config: StellarDIDConfig,
  signedXdr: string,
  options: { pollIntervalMs?: number; pollTimeoutMs?: number } = {}
): Promise<SubmittedTransactionResult> {
  if (typeof signedXdr !== "string" || signedXdr.trim().length === 0) {
    throw new Error("Signed transaction XDR must be a non-empty string");
  }

  let parsedTx;
  try {
    parsedTx = TransactionBuilder.fromXDR(signedXdr.trim(), config.networkPassphrase);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid signed transaction XDR: ${msg}`);
  }

  const server = getServer(config);
  if (
    typeof server.sendTransaction !== "function" ||
    typeof server.getTransaction !== "function"
  ) {
    throw new Error("Configured Soroban server does not support transaction submission");
  }

  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const pollTimeoutMs = options.pollTimeoutMs ?? 45_000;

  let sent = await server.sendTransaction(parsedTx);
  for (let attempt = 0; sent.status === "TRY_AGAIN_LATER" && attempt < 3; attempt += 1) {
    await sleep(pollIntervalMs);
    sent = await server.sendTransaction(parsedTx);
  }

  if (sent.status === "ERROR" || !sent.hash) {
    throw new Error(
      `Soroban RPC rejected transaction submission (status: ${sent.status ?? "unknown"})`
    );
  }

  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    let receipt: {
      status: string;
      ledger?: number;
      returnValue?: unknown;
      resultXdr?: unknown;
    };
    try {
      receipt = await server.getTransaction(sent.hash);
    } catch (err) {
      if (String((err as Error)?.message).includes("Bad union switch") && config.rpcUrl) {
        const res = await fetch(config.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTransaction",
            params: { hash: sent.hash },
          }),
        });
        const json = (await res.json()) as { result?: typeof receipt };
        if (!json.result) throw err;
        receipt = json.result;
      } else {
        throw err;
      }
    }
    if (receipt.status === "SUCCESS") {
      let decoded: unknown;
      if (receipt.returnValue) {
        try {
          decoded = scValToNative(receipt.returnValue as xdr.ScVal);
        } catch {
          decoded = undefined;
        }
      }
      return {
        hash: sent.hash,
        status: "SUCCESS",
        ledger: Number(receipt.ledger ?? 0),
        returnValue: decoded,
      };
    }
    if (receipt.status === "FAILED") {
      throw new Error(`Transaction ${sent.hash} failed on-chain`);
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for confirmation of transaction ${sent.hash}`);
}

/**
 * Encode a symbol argument.
 */
export function symbolArg(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "symbol" });
}

/**
 * Validate and encode a hex-encoded byte argument.
 */
export function bytesArg(hex: string, label = "value"): xdr.ScVal {
  if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0) {
    throw new Error(`${label} must be a non-empty, even-length hex string`);
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`${label} must be hex encoded`);
  }
  return nativeToScVal(Buffer.from(hex, "hex"), { type: "bytes" });
}

/**
 * Decode a byte value returned by the contract into lowercase hex.
 */
export function toHex(value: unknown): string {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "string") return value;
  throw new Error("Expected a byte value from the contract");
}
