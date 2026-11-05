/**
 * IssuerPage — Issuer Dashboard
 *
 * Issuers review pending KYC requests and approve/reject them.
 *
 * TODO for contributors:
 *  1. Obtain the issuer API key out of band (routes require `x-issuer-key`)
 *  2. Poll GET /api/issuer/requests every 5s with that header
 *  3. Display request cards (the listing is redacted; it has no document URLs)
 *  4. On approve: POST /api/issuer/approve (local placeholder only — no on-chain call)
 *  5. On reject: POST /api/issuer/reject with reason
 */

import { useState, useEffect } from "react";

interface KYCRequest {
  requestId: string;
  userId: string;
  attributes: string[];
  status: string;
}

export default function IssuerPage() {
  const [requests] = useState<KYCRequest[]>([]);

  useEffect(() => {
    // TODO: replace with real polling using issuer pubkey from wallet
    const interval = setInterval(() => {
      // fetch("/api/issuer/requests", { headers: { "x-issuer-key": key } }).then(...)
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  async function approve(requestId: string) {
    // TODO: POST /api/issuer/approve
    alert(`Approve ${requestId} — not yet implemented`);
  }

  async function reject(requestId: string) {
    // TODO: POST /api/issuer/reject
    alert(`Reject ${requestId} — not yet implemented`);
  }

  return (
    <section aria-labelledby="issuer-heading">
      <h2 id="issuer-heading">Issuer Dashboard</h2>
      {requests.length === 0 ? (
        <p>No pending requests. Connect your wallet to start polling.</p>
      ) : (
        <ul>
          {requests.map((r) => (
            <li key={r.requestId}>
              <strong>{r.userId}</strong> — {r.attributes.join(", ")}
              <button onClick={() => approve(r.requestId)} type="button">Approve</button>
              <button onClick={() => reject(r.requestId)} type="button">Reject</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
