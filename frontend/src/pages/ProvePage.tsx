import { useState, FormEvent } from "react";
import { VCClient } from "@stellar-did/sdk";
import { useWallet } from "../context/WalletContext";
import { getConfig } from "../config";

export default function ProvePage() {
  const { address } = useWallet();
  const [subjectAddress, setSubjectAddress] = useState<string>(address || "");
  const [attribute, setAttribute] = useState<string>("kyc_passed");
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [credentialDetails, setCredentialDetails] = useState<{
    subject: string;
    attribute: string;
    issuer: string;
    issuedAt: number;
    expiresAt: number;
    revoked: boolean;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const config = getConfig();

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    const target = subjectAddress.trim() || address;
    if (!target) {
      setError("Please provide a subject address to verify");
      return;
    }

    setLoading(true);
    setStatus("Querying Soroban VC Verifier contract...");
    setError("");
    setIsValid(null);
    setCredentialDetails(null);

    try {
      const client = new VCClient(config);

      const valid = await client.isCredentialValid(target, attribute);
      const details = await client.getCredential(target, attribute);

      setIsValid(valid);
      setCredentialDetails(details);
      setStatus(`Verification completed: Subject ${valid ? "HOLDS" : "DOES NOT HOLD"} a valid ${attribute} credential.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Verification query failed: ${msg}`);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="prove-heading" style={{ maxWidth: "680px", margin: "0 auto", padding: "1.5rem" }}>
      <h2 id="prove-heading">Attribute Credential Verification</h2>
      <p>Verify issuer-attested credentials live on Stellar.</p>

      <div style={{ background: "#fff3e0", border: "1px solid #ffe0b2", borderRadius: "8px", padding: "1rem", marginBottom: "1.5rem" }}>
        <h4 style={{ margin: "0 0 0.5rem", color: "#e65100" }}>Cryptographic & Privacy Notice (AUDIT.md C-2, C-3)</h4>
        <p style={{ margin: "0 0 0.5rem", fontSize: "13px", lineHeight: "1.5" }}>
          <strong>Zero-Knowledge / Ring-Signature Privacy Proofs are UNAVAILABLE.</strong> BLS12-381 ring signature verification in the contract is fail-closed (always returns <code>false</code>) because Protocol 21 lacks curve host functions and no formally reviewed scheme was specified.
        </p>
        <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.5" }}>
          The verification executed below inspects <strong>public on-chain Issuer-attested credentials</strong> with ledger sequence expiry and revocation checking. No user or attribute is marked as having zero-knowledge or cryptographic anonymity guarantees.
        </p>
      </div>

      <form onSubmit={handleVerify} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label>
          <strong>Subject Stellar Address (G...):</strong>
          <input
            type="text"
            value={subjectAddress}
            onChange={(e) => setSubjectAddress(e.target.value)}
            placeholder={address ? address : "G..."}
            required
            style={{ width: "100%", padding: "0.5rem" }}
          />
        </label>

        <label>
          <strong>Attribute:</strong>
          <select
            value={attribute}
            onChange={(e) => setAttribute(e.target.value)}
            style={{ width: "100%", padding: "0.5rem" }}
          >
            <option value="kyc_passed">kyc_passed</option>
            <option value="accredited_investor">accredited_investor</option>
            <option value="not_sanctioned">not_sanctioned</option>
            <option value="over_18">over_18</option>
          </select>
        </label>

        <button
          type="submit"
          disabled={loading}
          style={{ padding: "0.75rem", background: "#1976d2", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
        >
          {loading ? "Querying Verifier..." : "Verify Credential On-Chain"}
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

      {isValid !== null && (
        <div
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            borderRadius: "6px",
            background: isValid ? "#e8f5e9" : "#ffebee",
            border: `1px solid ${isValid ? "#2e7d32" : "#c62828"}`,
          }}
        >
          <h3>Result: {isValid ? "Valid Credential Verified" : "Not Valid / Not Found"}</h3>
          {credentialDetails ? (
            <div>
              <p><strong>Subject:</strong> <code>{credentialDetails.subject}</code></p>
              <p><strong>Attribute:</strong> <code>{credentialDetails.attribute}</code></p>
              <p><strong>Issuer:</strong> <code>{credentialDetails.issuer}</code></p>
              <p><strong>Issued At Ledger:</strong> {credentialDetails.issuedAt}</p>
              <p><strong>Expires At Ledger:</strong> {credentialDetails.expiresAt}</p>
              <p><strong>Revocation Status:</strong> {credentialDetails.revoked ? "REVOKED" : "Active"}</p>
            </div>
          ) : (
            <p>No credential record exists on-chain for this subject and attribute.</p>
          )}
        </div>
      )}
    </section>
  );
}
