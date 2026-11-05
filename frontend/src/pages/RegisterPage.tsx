import { useState, useEffect, FormEvent } from "react";
import { DIDClient } from "@stellar-did/sdk";
import { useWallet } from "../context/WalletContext";
import { getConfig } from "../config";

export default function RegisterPage() {
  const { address, isConnected, connectWallet, signTransaction } = useWallet();
  const [documentHash, setDocumentHash] = useState<string>(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  const [customWallet, setCustomWallet] = useState<string>("");
  const [resolvedDid, setResolvedDid] = useState<{
    id: string;
    documentHash: string;
    updatedAt: number;
    active: boolean;
  } | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [preparedXdr, setPreparedXdr] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const config = getConfig();

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
    }
  }, [address]);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    if (!address) {
      setError("Please connect your wallet first");
      return;
    }
    if (!documentHash || documentHash.length !== 64 || !/^[0-9a-fA-F]+$/.test(documentHash)) {
      setError("Document hash must be a 64-character hex string (SHA-256)");
      return;
    }

    setLoading(true);
    setStatus("Preparing registration transaction...");
    setError("");
    setPreparedXdr("");

    try {
      const client = new DIDClient({
        ...config,
        publicKey: address,
      });

      const xdr = await client.register(address, documentHash);
      setPreparedXdr(xdr);
      setStatus("Signing transaction with wallet...");

      await signTransaction(xdr);
      setStatus(`Transaction prepared and signed! Ready for Testnet submission. DID derived: did:stellar:${address}`);
      setResolvedDid({
        id: `did:stellar:${address}`,
        documentHash,
        updatedAt: Math.floor(Date.now() / 1000),
        active: true,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Registration error: ${msg}`);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="register-heading" style={{ maxWidth: "680px", margin: "0 auto", padding: "1.5rem" }}>
      <h2 id="register-heading">Register & Manage Your DID</h2>
      <p>Anchor a W3C-compliant Decentralized Identifier on Stellar.</p>

      <div style={{ background: "#f5f5f5", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
        <h3>Wallet Connection</h3>
        {isConnected ? (
          <div>
            <p><strong>Connected Address:</strong> <code>{address}</code></p>
            <p><strong>Network:</strong> Stellar Testnet</p>
          </div>
        ) : (
          <div>
            <p>No wallet connected. Connect Freighter or enter a Stellar address:</p>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <input
                type="text"
                placeholder="G..."
                value={customWallet}
                onChange={(e) => setCustomWallet(e.target.value)}
                style={{ flex: 1, padding: "0.5rem" }}
              />
              <button type="button" onClick={() => connectWallet(customWallet)} style={{ padding: "0.5rem 1rem" }}>
                Connect Address
              </button>
            </div>
            <button type="button" onClick={() => connectWallet()} style={{ padding: "0.5rem 1rem" }}>
              Connect Freighter
            </button>
          </div>
        )}
      </div>

      {resolvedDid && (
        <div style={{ background: "#e8f5e9", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#2e7d32" }}>Active DID Document</h3>
          <p><strong>DID:</strong> <code>{resolvedDid.id}</code></p>
          <p><strong>Document Hash:</strong> <code>{resolvedDid.documentHash}</code></p>
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
          {loading ? "Processing..." : "Register DID on Stellar"}
        </button>
      </form>

      {status && (
        <div role="status" style={{ marginTop: "1rem", padding: "0.75rem", background: "#e3f2fd", borderRadius: "4px" }}>
          {status}
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
