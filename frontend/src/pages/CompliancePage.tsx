import { useState, FormEvent } from "react";
import { ComplianceClient } from "@stellar-did/sdk";
import { useWallet } from "../context/WalletContext";
import { getConfig } from "../config";

export default function CompliancePage() {
  const { address } = useWallet();
  const [subjectAddress, setSubjectAddress] = useState<string>(address || "");
  const [policyName, setPolicyName] = useState<string>("defi_pool");
  const [isCompliant, setIsCompliant] = useState<boolean | null>(null);
  const [policyDetails, setPolicyDetails] = useState<{
    name: string;
    requiredAttributes: string[];
    version: number;
  } | null>(null);
  const [exportedAttestation, setExportedAttestation] = useState<{
    subject: string;
    policy: string;
    compliant: boolean;
    evaluatedAt: number;
    policyVersion: number;
    verifier: string;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const config = getConfig();

  async function handleEvaluate(e: FormEvent) {
    e.preventDefault();
    const target = subjectAddress.trim() || address;
    if (!target) {
      setError("Please provide a subject address to evaluate");
      return;
    }

    setLoading(true);
    setStatus("Evaluating compliance on-chain...");
    setError("");
    setIsCompliant(null);
    setPolicyDetails(null);
    setExportedAttestation(null);

    try {
      const client = new ComplianceClient(config);

      const compliant = await client.isCompliant(target, policyName);
      setIsCompliant(compliant);

      try {
        const policy = await client.getPolicy(policyName);
        setPolicyDetails(policy);
      } catch {
        // Policy might not exist or be unconfigured
      }

      setStatus(`Live compliance evaluation: Subject is ${compliant ? "COMPLIANT" : "NON-COMPLIANT"} under ${policyName}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Compliance check error: ${msg}`);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    const target = subjectAddress.trim() || address;
    if (!target) return;

    setLoading(true);
    setError("");
    setStatus("Generating compliance attestation snapshot...");
    try {
      const client = new ComplianceClient(config);

      const attestation = await client.exportAttestation(target, policyName);
      setExportedAttestation(attestation);
      setStatus("Point-in-time attestation snapshot exported and event published!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Attestation export error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="compliance-heading" style={{ maxWidth: "680px", margin: "0 auto", padding: "1.5rem" }}>
      <h2 id="compliance-heading">On-Chain Compliance Evaluation</h2>
      <p>Evaluate live KYC/AML compliance against policy rules without stored assertions (AUDIT.md C-5, C-6).</p>

      <form onSubmit={handleEvaluate} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label>
          <strong>Subject Address:</strong>
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
          <strong>Policy Name:</strong>
          <input
            type="text"
            value={policyName}
            onChange={(e) => setPolicyName(e.target.value)}
            placeholder="e.g. defi_pool"
            required
            style={{ width: "100%", padding: "0.5rem" }}
          />
        </label>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="submit"
            disabled={loading}
            style={{ flex: 1, padding: "0.75rem", background: "#1976d2", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
          >
            {loading ? "Evaluating..." : "Evaluate Compliance"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={loading}
            style={{ padding: "0.75rem 1rem", background: "#388e3c", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
          >
            Export Attestation
          </button>
        </div>
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

      {isCompliant !== null && (
        <div
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            borderRadius: "6px",
            background: isCompliant ? "#e8f5e9" : "#ffebee",
            border: `1px solid ${isCompliant ? "#2e7d32" : "#c62828"}`,
          }}
        >
          <h3>Status: {isCompliant ? "COMPLIANT" : "NON-COMPLIANT"}</h3>
          {policyDetails && (
            <div>
              <p><strong>Policy Name:</strong> {policyDetails.name}</p>
              <p><strong>Required Attributes:</strong> {policyDetails.requiredAttributes.join(", ")}</p>
              <p><strong>Policy Version:</strong> {policyDetails.version}</p>
            </div>
          )}
        </div>
      )}

      {exportedAttestation && (
        <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#f3e5f5", borderRadius: "6px", border: "1px solid #ab47bc" }}>
          <h3>Exported Cross-Chain Attestation</h3>
          <p><strong>Subject:</strong> <code>{exportedAttestation.subject}</code></p>
          <p><strong>Policy:</strong> {exportedAttestation.policy}</p>
          <p><strong>Compliant:</strong> {exportedAttestation.compliant ? "True" : "False"}</p>
          <p><strong>Evaluated Ledger:</strong> {exportedAttestation.evaluatedAt}</p>
          <p><strong>Policy Version:</strong> {exportedAttestation.policyVersion}</p>
          <p><strong>Verifier Contract:</strong> <code>{exportedAttestation.verifier}</code></p>
        </div>
      )}
    </section>
  );
}
