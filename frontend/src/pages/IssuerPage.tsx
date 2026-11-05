import { useState, useEffect } from "react";
import { getConfig } from "../config";

interface KYCRequest {
  requestId: string;
  userId: string;
  attributes: string[];
  status: string;
  createdAt: string;
  hasDocument: boolean;
}

export default function IssuerPage() {
  const [apiKey, setApiKey] = useState<string>("dev-issuer-key");
  const [requests, setRequests] = useState<KYCRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [rejectionReason, setRejectionReason] = useState<string>("Invalid documentation");

  const config = getConfig();

  const fetchRequests = async () => {
    if (!apiKey) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${config.kycIssuerUrl}/api/issuer/requests`, {
        headers: { "x-issuer-key": apiKey },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load requests");
      }
      setRequests(data);
      setStatus(`Loaded ${data.length} pending KYC request(s).`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Error: ${msg}`);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  async function handleApprove(requestId: string) {
    setLoading(true);
    setError("");
    setStatus(`Approving request ${requestId}...`);
    try {
      const res = await fetch(`${config.kycIssuerUrl}/api/issuer/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-issuer-key": apiKey,
        },
        body: JSON.stringify({ requestId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approval failed");

      setStatus(`Request ${requestId} approved! Credential ready for one-time retrieval.`);
      await fetchRequests();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Approval error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleReject(requestId: string) {
    setLoading(true);
    setError("");
    setStatus(`Rejecting request ${requestId}...`);
    try {
      const res = await fetch(`${config.kycIssuerUrl}/api/issuer/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-issuer-key": apiKey,
        },
        body: JSON.stringify({ requestId, reason: rejectionReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rejection failed");

      setStatus(`Request ${requestId} rejected.`);
      await fetchRequests();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Rejection error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="issuer-heading" style={{ maxWidth: "760px", margin: "0 auto", padding: "1.5rem" }}>
      <h2 id="issuer-heading">Issuer Verification Dashboard</h2>
      <p>Review submitted KYC applications, verify identity documents, and issue attested credentials.</p>

      <div style={{ background: "#f5f5f5", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
        <h3>Issuer Authentication</h3>
        <p>Issuer routes are protected by server-side API keys (AUDIT.md C-7, C-9).</p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="x-issuer-key"
            style={{ flex: 1, padding: "0.5rem" }}
          />
          <button type="button" onClick={fetchRequests} disabled={loading} style={{ padding: "0.5rem 1rem" }}>
            Refresh Applications
          </button>
        </div>
      </div>

      {status && (
        <div role="status" style={{ margin: "1rem 0", padding: "0.75rem", background: "#e8f5e9", color: "#2e7d32", borderRadius: "4px" }}>
          {status}
        </div>
      )}

      {error && (
        <div role="alert" style={{ margin: "1rem 0", padding: "0.75rem", background: "#ffebee", color: "#c62828", borderRadius: "4px" }}>
          {error}
        </div>
      )}

      <h3>Pending KYC Applications ({requests.length})</h3>
      {requests.length === 0 ? (
        <p>No pending applications for this issuer key.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {requests.map((req) => (
            <div key={req.requestId} style={{ border: "1px solid #ddd", borderRadius: "6px", padding: "1rem", background: "white" }}>
              <h4>Application: <code>{req.requestId}</code></h4>
              <p><strong>Subject ID:</strong> {req.userId}</p>
              <p><strong>Attributes:</strong> {req.attributes.map(a => <code key={a} style={{ marginRight: "4px" }}>{a}</code>)}</p>
              <p><strong>Submitted:</strong> {new Date(req.createdAt).toLocaleString()}</p>
              <p><strong>ID Document Attached:</strong> {req.hasDocument ? "Yes" : "No"}</p>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => handleApprove(req.requestId)}
                  disabled={loading}
                  style={{ background: "#2e7d32", color: "white", padding: "0.5rem 1rem", border: "none", borderRadius: "4px", cursor: "pointer" }}
                >
                  Approve Credential
                </button>
                <button
                  type="button"
                  onClick={() => handleReject(req.requestId)}
                  disabled={loading}
                  style={{ background: "#d32f2f", color: "white", padding: "0.5rem 1rem", border: "none", borderRadius: "4px", cursor: "pointer" }}
                >
                  Reject
                </button>
                <input
                  type="text"
                  placeholder="Rejection reason"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  style={{ padding: "0.5rem", flex: 1 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
