/**
 * AdminPage — System Administration
 *
 * Admin initialises contracts and registers trusted issuers.
 *
 * TODO for contributors:
 *  1. Connect Freighter wallet (admin address)
 *  2. Call VCVerifier.initialize() once
 *  3. Generate BLS keypair for a new issuer
 *  4. Call VCVerifier.add_issuer() with the issuer's BLS public key
 *  5. Securely transmit the issuer's private key out-of-band
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
          Issuer BLS Public Key (hex, 192 chars)
          <input
            value={issuerPubkey}
            onChange={(e) => setIssuerPubkey(e.target.value)}
            placeholder="0x..."
            maxLength={192}
          />
        </label>
        <button type="submit" disabled={issuerPubkey.length !== 192}>
          Register Issuer
        </button>
      </form>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
