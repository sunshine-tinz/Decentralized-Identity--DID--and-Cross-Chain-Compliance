import { useState, FormEvent } from "react";
import { useWallet } from "../context/WalletContext";
import { getConfig } from "../config";

const AVAILABLE_ATTRIBUTES = [
  "kyc_passed",
  "accredited_investor",
  "not_sanctioned",
  "over_18",
];

export default function VerifyPage() {
  const { address } = useWallet();
  const [selectedAttrs, setSelectedAttrs] = useState<string[]>(["kyc_passed"]);
  const [userId, setUserId] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("Alice");
  const [lastName, setLastName] = useState<string>("Smith");
  const [dob, setDob] = useState<string>("1990-01-01");
  const [issuerPubkey, setIssuerPubkey] = useState<string>(
    "a".repeat(192) // default 192 hex chars for mock/test issuer
  );

  const [requestId, setRequestId] = useState<string>("");
  const [retrievalToken, setRetrievalToken] = useState<string>("");
  const [kycStatus, setKycStatus] = useState<string>("");
  const [retrievedCred, setRetrievedCred] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  const config = getConfig();

  function toggleAttr(attr: string) {
    setSelectedAttrs((prev) =>
      prev.includes(attr) ? prev.filter((a) => a !== attr) : [...prev, attr]
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const uid = userId.trim() || (address ? address.slice(0, 16) : "user_" + Date.now());

    try {
      const res = await fetch(`${config.kycIssuerUrl}/api/kyc/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: uid,
          attributes: selectedAttrs,
          personalInfo: { firstName, lastName, dob },
          issuerPubkey,
          documentPhoto: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit KYC request");
      }

      setRequestId(data.requestId);
      setRetrievalToken(data.retrievalToken);
      setKycStatus(data.status);
      setMessage(`KYC request submitted successfully! Request ID: ${data.requestId}. One-time retrieval token issued.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Error submitting request: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function checkStatus() {
    if (!requestId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${config.kycIssuerUrl}/api/kyc/status/${requestId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status check failed");
      setKycStatus(data.status);
      setMessage(`Request ${requestId} status: ${data.status}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Status check error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function retrieveCredential() {
    if (!retrievalToken) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${config.kycIssuerUrl}/api/kyc/credential/${retrievalToken}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Credential retrieval failed");
      setRetrievedCred(data);
      setMessage("Credential retrieved successfully via single-use token!");
      localStorage.setItem(`credential_${requestId}`, JSON.stringify(data));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Credential retrieval error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="verify-heading" style={{ maxWidth: "680px", margin: "0 auto", padding: "1.5rem" }}>
      <h2 id="verify-heading">Request KYC Verification</h2>
      <p>Submit identity information to an authenticated KYC issuer off-chain.</p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <fieldset style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "4px" }}>
          <legend><strong>Required Compliance Attributes</strong></legend>
          {AVAILABLE_ATTRIBUTES.map((attr) => (
            <label key={attr} style={{ display: "block", margin: "0.25rem 0" }}>
              <input
                type="checkbox"
                checked={selectedAttrs.includes(attr)}
                onChange={() => toggleAttr(attr)}
              />{" "}
              <code>{attr}</code>
            </label>
          ))}
        </fieldset>

        <label>
          <strong>User ID / Subject Reference:</strong>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={address ? address : "user_12345"}
            style={{ width: "100%", padding: "0.5rem" }}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <label>
            First Name:
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Last Name:
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </label>
        </div>

        <label>
          Date of Birth:
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
            style={{ width: "100%", padding: "0.5rem" }}
          />
        </label>

        <label>
          Target Issuer BLS Public Key (192 hex chars):
          <input
            type="text"
            value={issuerPubkey}
            onChange={(e) => setIssuerPubkey(e.target.value)}
            maxLength={192}
            required
            style={{ width: "100%", padding: "0.5rem", fontFamily: "monospace", fontSize: "11px" }}
          />
        </label>

        <button
          type="submit"
          disabled={loading || selectedAttrs.length === 0}
          style={{ padding: "0.75rem", background: "#1976d2", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
        >
          {loading ? "Submitting..." : "Submit KYC Application"}
        </button>
      </form>

      {message && (
        <div role="status" style={{ marginTop: "1rem", padding: "0.75rem", background: "#e8f5e9", color: "#2e7d32", borderRadius: "4px" }}>
          {message}
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: "1rem", padding: "0.75rem", background: "#ffebee", color: "#c62828", borderRadius: "4px" }}>
          {error}
        </div>
      )}

      {requestId && (
        <div style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid #1976d2", borderRadius: "6px", background: "#f8fbff" }}>
          <h3>Application Details</h3>
          <p><strong>Request ID:</strong> <code>{requestId}</code></p>
          <p><strong>One-Time Retrieval Token:</strong> <code>{retrievalToken}</code></p>
          <p><strong>Status:</strong> <span style={{ fontWeight: "bold" }}>{kycStatus}</span></p>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="button" onClick={checkStatus} style={{ padding: "0.5rem 1rem" }}>
              Check Status
            </button>
            <button
              type="button"
              onClick={retrieveCredential}
              disabled={kycStatus !== "approved"}
              style={{
                padding: "0.5rem 1rem",
                background: kycStatus === "approved" ? "#2e7d32" : "#9e9e9e",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: kycStatus === "approved" ? "pointer" : "not-allowed",
              }}
            >
              Retrieve Credential
            </button>
          </div>
        </div>
      )}

      {Boolean(retrievedCred) && (
        <div style={{ marginTop: "1rem", padding: "1rem", background: "#e0f2f1", borderRadius: "6px" }}>
          <h4>Retrieved Credential Envelope</h4>
          <pre style={{ fontSize: "12px", overflowX: "auto" }}>
            {JSON.stringify(retrievedCred, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
