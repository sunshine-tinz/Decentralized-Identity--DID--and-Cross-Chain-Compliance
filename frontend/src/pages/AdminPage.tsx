/**
 * AdminPage — System Administration
 *
 * Admin initialises contracts and registers trusted issuers.
 *
 * TODO for contributors:
 *  1. Connect Freighter wallet (admin address)
 *  2. Call VCVerifier.initialize() once
 *  3. Obtain the issuer's Stellar address
 *  4. Call VCVerifier.add_issuer() with that address (the contract registers
 *     addresses, not BLS public keys)
 *  5. Provision the issuer's API key out of band for the KYC service
 */

import React, { useState } from "react";

export default function AdminPage() {
  const [issuerPubkey, setIssuerPubkey] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  async function handleAddIssuer(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Adding issuer...");
    // TODO: call VCVerifier.add_issuer() via SDK
    setStatus("Not yet implemented — see contracts/vc_verifier/src/lib.rs");
  }

  return (
    <section aria-labelledby="admin-heading">
      <h2 id="admin-heading">Admin Panel</h2>
      <form onSubmit={handleAddIssuer}>
        <label>
          Issuer Stellar address (G..., 56 chars)
          <input
            value={issuerPubkey}
            onChange={(e) => setIssuerPubkey(e.target.value)}
            placeholder="G..."
            maxLength={56}
          />
        </label>
        <button type="submit" disabled={issuerPubkey.length !== 56}>
          Register Issuer
        </button>
      </form>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
