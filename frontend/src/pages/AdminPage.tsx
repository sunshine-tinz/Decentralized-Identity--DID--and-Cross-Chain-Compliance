import { useState, useEffect, FormEvent } from "react";
import { VCClient, ComplianceClient, submitSignedTransaction } from "@stellar-did/sdk";
import { StrKey } from "@stellar/stellar-sdk";
import { useWallet } from "../context/WalletContext";
import { getConfig, saveConfig } from "../config";

export default function AdminPage() {
  const { address, isConnected, signTransaction } = useWallet();
  const [issuers, setIssuers] = useState<string[]>([]);
  const [newIssuer, setNewIssuer] = useState<string>("");
  const [removeIssuerAddress, setRemoveIssuerAddress] = useState<string>("");
  const [policyName, setPolicyName] = useState<string>("defi_pool");
  const [policyAttrs, setPolicyAttrs] = useState<string>("kyc_passed,not_sanctioned");
  const [newVerifier, setNewVerifier] = useState<string>("");
  const [configuredVerifier, setConfiguredVerifier] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [preparedXdr, setPreparedXdr] = useState<string>("");
  const [lastTxHash, setLastTxHash] = useState<string>("");

  const config = getConfig();

  const loadData = async () => {
    try {
      const vcClient = new VCClient(config);
      const registered = await vcClient.getIssuers();
      setIssuers(registered);

      const compClient = new ComplianceClient(config);
      const verifier = await compClient.getVerifier();
      if (verifier) setConfiguredVerifier(verifier);
    } catch {
      // Contract might be fresh or uninitialized
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  async function submitAdminTx(label: string, buildXdr: () => Promise<string>, afterConfirm?: () => Promise<void>) {
    if (!address) {
      setError("Connect admin Freighter wallet first");
      return;
    }

    setLoading(true);
    setError("");
    setPreparedXdr("");
    setLastTxHash("");
    setStatus(`Preparing ${label} transaction...`);

    try {
      const xdr = await buildXdr();
      setPreparedXdr(xdr);

      setStatus(`Waiting for Freighter signature for ${label}...`);
      const signedXdr = await signTransaction(xdr);

      setStatus(`Submitting ${label} to Stellar RPC and awaiting confirmation...`);
      const receipt = await submitSignedTransaction(config, signedXdr);
      setLastTxHash(receipt.hash);

      if (afterConfirm) {
        await afterConfirm();
      }
      await loadData();

      setStatus(`${label} confirmed on ledger ${receipt.ledger} (tx: ${receipt.hash}).`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`${label} failed: ${msg}`);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddIssuer(e: FormEvent) {
    e.preventDefault();
    if (!StrKey.isValidEd25519PublicKey(newIssuer.trim())) {
      setError("Issuer address must be a valid Stellar public key (G...)");
      return;
    }
    const target = newIssuer.trim();
    await submitAdminTx(
      "add_issuer",
      () => new VCClient({ ...config, publicKey: address }).addIssuer(address, target),
      async () => setNewIssuer("")
    );
  }

  async function handleRemoveIssuer(e: FormEvent) {
    e.preventDefault();
    if (!StrKey.isValidEd25519PublicKey(removeIssuerAddress.trim())) {
      setError("Issuer address must be a valid Stellar public key (G...)");
      return;
    }
    const target = removeIssuerAddress.trim();
    await submitAdminTx(
      "remove_issuer",
      () => new VCClient({ ...config, publicKey: address }).removeIssuer(address, target),
      async () => setRemoveIssuerAddress("")
    );
  }

  async function handleSetPolicy(e: FormEvent) {
    e.preventDefault();
    const attrs = policyAttrs
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    if (attrs.length === 0) {
      setError("At least one attribute is required");
      return;
    }

    await submitAdminTx("set_policy", () =>
      new ComplianceClient({ ...config, publicKey: address }).setPolicy(address, policyName.trim(), attrs)
    );
  }

  async function handleSetVerifier(e: FormEvent) {
    e.preventDefault();
    if (!StrKey.isValidContract(newVerifier.trim())) {
      setError("Verifier address must be a valid Stellar contract address (C...)");
      return;
    }
    const target = newVerifier.trim();
    await submitAdminTx(
      "set_verifier",
      () => new ComplianceClient({ ...config, publicKey: address }).setVerifier(address, target),
      async () => {
        saveConfig({ vcVerifierId: target });
        setNewVerifier("");
      }
    );
  }

  return (
    <section aria-labelledby="admin-heading" style={{ maxWidth: "760px", margin: "0 auto", padding: "1.5rem" }}>
      <h2 id="admin-heading">System Administration Panel</h2>
      <p>Manage trusted issuers, compliance policy definitions, and verifier contracts.</p>

      <div style={{ background: "#f5f5f5", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
        <h3>Admin Wallet</h3>
        {isConnected ? (
          <p><strong>Admin Address:</strong> <code>{address}</code></p>
        ) : (
          <p style={{ color: "#d32f2f" }}>Please connect your admin Freighter wallet from the Register page first.</p>
        )}
      </div>

      {status && (
        <div role="status" style={{ margin: "1rem 0", padding: "0.75rem", background: "#e8f5e9", color: "#2e7d32", borderRadius: "4px" }}>
          {status}
        </div>
      )}

      {lastTxHash && (
        <div style={{ margin: "0.5rem 0", padding: "0.5rem 0.75rem", background: "#e3f2fd", borderRadius: "4px", fontSize: "13px" }}>
          <strong>Confirmed Tx:</strong> <code>{lastTxHash}</code>
        </div>
      )}

      {error && (
        <div role="alert" style={{ margin: "1rem 0", padding: "0.75rem", background: "#ffebee", color: "#c62828", borderRadius: "4px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ border: "1px solid #ddd", padding: "1rem", borderRadius: "6px" }}>
          <h4>Add Trusted Issuer</h4>
          <form onSubmit={handleAddIssuer}>
            <label>
              Stellar Address (G...):
              <input
                type="text"
                value={newIssuer}
                onChange={(e) => setNewIssuer(e.target.value)}
                placeholder="G..."
                required
                style={{ width: "100%", padding: "0.5rem", margin: "0.5rem 0" }}
              />
            </label>
            <button
              type="submit"
              disabled={loading || !isConnected}
              style={{ width: "100%", padding: "0.5rem", background: "#1976d2", color: "white", border: "none", borderRadius: "4px" }}
            >
              {loading ? "Processing..." : "Add Issuer"}
            </button>
          </form>
        </div>

        <div style={{ border: "1px solid #ddd", padding: "1rem", borderRadius: "6px" }}>
          <h4>Remove Issuer</h4>
          <form onSubmit={handleRemoveIssuer}>
            <label>
              Stellar Address (G...):
              <input
                type="text"
                value={removeIssuerAddress}
                onChange={(e) => setRemoveIssuerAddress(e.target.value)}
                placeholder="G..."
                required
                style={{ width: "100%", padding: "0.5rem", margin: "0.5rem 0" }}
              />
            </label>
            <button
              type="submit"
              disabled={loading || !isConnected}
              style={{ width: "100%", padding: "0.5rem", background: "#d32f2f", color: "white", border: "none", borderRadius: "4px" }}
            >
              {loading ? "Processing..." : "Remove Issuer (Invalidates Credentials)"}
            </button>
          </form>
        </div>
      </div>

      <div style={{ border: "1px solid #ddd", padding: "1rem", borderRadius: "6px", marginBottom: "1.5rem" }}>
        <h4>Registered Issuers ({issuers.length})</h4>
        {issuers.length === 0 ? (
          <p>No issuers currently registered.</p>
        ) : (
          <ul>
            {issuers.map((i) => (
              <li key={i}><code>{i}</code></li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ border: "1px solid #ddd", padding: "1rem", borderRadius: "6px", marginBottom: "1.5rem" }}>
        <h4>Set Compliance Policy</h4>
        <form onSubmit={handleSetPolicy} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <label>
            Policy Name:
            <input
              type="text"
              value={policyName}
              onChange={(e) => setPolicyName(e.target.value)}
              required
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Required Attributes (comma-separated):
            <input
              type="text"
              value={policyAttrs}
              onChange={(e) => setPolicyAttrs(e.target.value)}
              required
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </label>
          <button
            type="submit"
            disabled={loading || !isConnected}
            style={{ padding: "0.5rem", background: "#388e3c", color: "white", border: "none", borderRadius: "4px" }}
          >
            {loading ? "Processing..." : "Configure Policy"}
          </button>
        </form>
      </div>

      <div style={{ border: "1px solid #ddd", padding: "1rem", borderRadius: "6px" }}>
        <h4>Link VC Verifier to Compliance Engine</h4>
        {configuredVerifier && (
          <p>Current Verifier: <code>{configuredVerifier}</code></p>
        )}
        <form onSubmit={handleSetVerifier} style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="text"
            value={newVerifier}
            onChange={(e) => setNewVerifier(e.target.value)}
            placeholder="C..."
            required
            style={{ flex: 1, padding: "0.5rem" }}
          />
          <button
            type="submit"
            disabled={loading || !isConnected}
            style={{ padding: "0.5rem 1rem", background: "#1976d2", color: "white", border: "none", borderRadius: "4px" }}
          >
            Set Verifier
          </button>
        </form>
      </div>

      {preparedXdr && (
        <div style={{ marginTop: "1.5rem" }}>
          <h4>Prepared Transaction XDR:</h4>
          <textarea
            readOnly
            value={preparedXdr}
            rows={3}
            style={{ width: "100%", fontSize: "11px", fontFamily: "monospace" }}
          />
        </div>
      )}
    </section>
  );
}
