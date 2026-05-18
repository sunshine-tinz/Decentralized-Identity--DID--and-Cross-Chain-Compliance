/**
 * IssuerPage — Issuer Dashboard
 *
 * Issuers review pending KYC requests and approve/reject them.
 *
 * TODO for contributors:
 *  1. Connect Freighter wallet (issuer address)
 *  2. Poll GET /api/issuer/requests?issuerPubkey=<key> every 5s
 *  3. Display request cards with document thumbnails
 *  4. On approve: POST /api/issuer/approve (triggers on-chain ring creation)
 *  5. On reject: POST /api/issuer/reject with reason
 */

import React, { useState, useEffect } from "react";

interface KYCRequest {
  requestId: string;
  userId: string;
  attributes: string[];
  status: string;
}

export default function IssuerPage() {
  const [requests, setRequests] = useState<KYCRequest[]>([]);

  useEffect(() => {
    // TODO: replace with real polling using issuer pubkey from wallet
    const interval = setInterval(() => {
      // fetch("/api/issuer/requests?issuerPubkey=...").then(...)
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
