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
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { SorobanServerLike, StellarDIDConfig } from "../types";

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
  return new SorobanRpc.Server(config.rpcUrl) as unknown as SorobanServerLike;
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
  const prepared = (await server.prepareTransaction(tx)) as { toXDR(): string };
  return prepared.toXDR();
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
