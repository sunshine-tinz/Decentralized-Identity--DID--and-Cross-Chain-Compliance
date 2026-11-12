import { useState, useEffect, FormEvent } from "react";
import { DIDClient, submitSignedTransaction } from "@stellar-did/sdk";
import { useWallet } from "../context/WalletContext";
import { getConfig } from "../config";

export default function RegisterPage() {
  const {
    address,
    isConnected,
    isFreighter,
    connecting,
    walletError,
    connectWallet,
    disconnectWallet,
    signTransaction,
    network,
  } = useWallet();
  const [documentHash, setDocumentHash] = useState<string>(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  const [resolvedDid, setResolvedDid] = useState<{
    id: string;
    documentHash: string;
    updatedAt: number;
    active: boolean;
  } | null>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "signing" | "submitting" | "confirmed" | "failed">("idle");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [preparedXdr, setPreparedXdr] = useState<string>("");
  const [txHash, setTxHash] = useState<string>("");
  const [confirmedLedger, setConfirmedLedger] = useState<number | null>(null);

  const config = getConfig();
  const loading = phase === "preparing" || phase === "signing" || phase === "submitting";

  const loadExistingDID = async (targetAddress: string) => {
    if (!targetAddress) return;
    try {
      const client = new DIDClient({
        ...config,
        publicKey: targetAddress,
      });
      const doc = await client.resolve(targetAddress);
      setResolvedDid(doc);
    } catch {
      setResolvedDid(null);
    }
  };

  useEffect(() => {
    if (address) {
      loadExistingDID(address);
    } else {
      setResolvedDid(null);
    }
  }, [address]);

  async function handleConnect() {
    setError("");
    try {
      await connectWallet();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }

  async function executeDidTx(action: "register" | "update") {
    if (!address) {
      setError("Please connect your Freighter wallet first");
      return;
    }
    if (!documentHash || documentHash.length !== 64 || !/^[0-9a-fA-F]+$/.test(documentHash)) {
      setError("Document hash must be a 64-character hex string (SHA-256)");
      return;
    }

    setPhase("preparing");
    setStatus("Building, simulating, and preparing Soroban transaction...");
    setError("");
    setPreparedXdr("");
    setTxHash("");
    setConfirmedLedger(null);

    try {
      const client = new DIDClient({
        ...config,
        publicKey: address,
      });

      const xdr =
        action === "register"
          ? await client.register(address, documentHash)
          : await client.update(address, documentHash);
      setPreparedXdr(xdr);

      setPhase("signing");
      setStatus("Waiting for Freighter wallet signature...");
      const signedXdr = await signTransaction(xdr);

      setPhase("submitting");
      setStatus("Submitting signed transaction to Stellar RPC and awaiting finality...");
      const receipt = await submitSignedTransaction(config, signedXdr);
      setTxHash(receipt.hash);
      setConfirmedLedger(receipt.ledger);

      // Re-query confirmed on-chain state rather than trusting local state.
      const confirmedDoc = await client.resolve(address);
      setResolvedDid(confirmedDoc);
      setPhase("confirmed");
      setStatus(
        `Transaction confirmed on ledger ${receipt.ledger} (hash: ${receipt.hash}). DID: ${confirmedDoc.id}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPhase("failed");
      setError(`DID ${action} failed: ${msg}`);
      setStatus("");
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    await executeDidTx(resolvedDid?.active ? "update" : "register");
  }

  return (
    <section aria-labelledby="register-heading" style={{ maxWidth: "680px", margin: "0 auto", padding: "1.5rem" }}>
      <h2 id="register-heading">Register & Manage Your DID</h2>
      <p>Anchor a Decentralized Identifier on Stellar using your Freighter wallet.</p>

      <div style={{ background: "#f5f5f5", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
        <h3>Wallet Connection</h3>
        {isConnected ? (
          <div>
            <p><strong>Connected Address:</strong> <code>{address}</code></p>
            <p><strong>Network:</strong> {network}</p>
            <button type="button" onClick={disconnectWallet} style={{ padding: "0.4rem 0.8rem" }}>
              Disconnect Wallet
            </button>
          </div>
        ) : (
          <div>
            {!isFreighter && (
              <p style={{ color: "#b71c1c", fontSize: "13px" }}>
                Freighter browser extension not detected. Install Freighter to connect and sign transactions.
              </p>
            )}
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              style={{ padding: "0.5rem 1rem" }}
            >
              {connecting ? "Connecting..." : "Connect Freighter"}
            </button>
          </div>
        )}
        {walletError && (
          <p role="alert" style={{ color: "#c62828", marginTop: "0.5rem", fontSize: "13px" }}>
            {walletError}
          </p>
        )}
      </div>

      {resolvedDid && (
        <div style={{ background: "#e8f5e9", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#2e7d32" }}>On-Chain DID Document</h3>
          <p><strong>DID:</strong> <code>{resolvedDid.id}</code></p>
          <p><strong>Document Hash:</strong> <code>{resolvedDid.documentHash}</code></p>
          <p><strong>Updated Ledger:</strong> {resolvedDid.updatedAt}</p>
          <p><strong>Status:</strong> {resolvedDid.active ? "Active" : "Deactivated"}</p>
        </div>
      )}

      <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label>
          <strong>Off-chain Document SHA-256 Hash (Hex):</strong>
          <input
            type="text"
            value={documentHash}
            onChange={(e) => setDocumentHash(e.target.value)}
            placeholder="64-character hex hash"
            maxLength={64}
            required
            style={{ width: "100%", padding: "0.5rem", fontFamily: "monospace" }}
          />
        </label>

        <button
          type="submit"
          disabled={loading || !isConnected}
          style={{ padding: "0.75rem", background: "#1976d2", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
        >
          {loading
            ? `Processing (${phase})...`
            : resolvedDid?.active
            ? "Update DID Document Hash"
            : "Register DID on Stellar"}
        </button>
      </form>

      {status && (
        <div role="status" style={{ marginTop: "1rem", padding: "0.75rem", background: "#e3f2fd", borderRadius: "4px" }}>
          {status}
        </div>
      )}

      {txHash && (
        <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "#e8f5e9", borderRadius: "4px", fontSize: "13px" }}>
          <strong>Confirmed Tx Hash:</strong> <code>{txHash}</code>
          {confirmedLedger !== null && <span> (Ledger {confirmedLedger})</span>}
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: "1rem", padding: "0.75rem", background: "#ffebee", color: "#c62828", borderRadius: "4px" }}>
          {error}
        </div>
      )}

      {preparedXdr && (
        <div style={{ marginTop: "1rem", wordBreak: "break-all" }}>
          <h4>Prepared Transaction XDR:</h4>
          <textarea
            readOnly
            value={preparedXdr}
            rows={4}
            style={{ width: "100%", fontSize: "12px", fontFamily: "monospace" }}
          />
        </div>
      )}
    </section>
  );
}
