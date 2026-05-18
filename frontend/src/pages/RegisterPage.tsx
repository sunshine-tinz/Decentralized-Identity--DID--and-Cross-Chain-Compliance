/**
 * RegisterPage — DID Registration
 *
 * Allows a user to anchor their DID on Stellar.
 *
 * TODO for contributors:
 *  1. Connect Freighter wallet to get the controller address
 *  2. Generate a W3C DID document (off-chain) and compute its SHA-256 hash
 *  3. Upload the document to IPFS (or anchor server)
 *  4. Call DIDClient.register(address, documentHash) via the SDK
 *  5. Display the resulting DID string
 */

import React, { useState } from "react";

export default function RegisterPage() {
  const [status, setStatus] = useState<string>("");

  async function handleRegister() {
    setStatus("Connecting wallet...");
    // TODO: connect Freighter wallet
    // TODO: generate DID document
    // TODO: call DIDClient.register()
    setStatus("Not yet implemented — see sdk/src/clients/DIDClient.ts");
  }

  return (
    <section aria-labelledby="register-heading">
      <h2 id="register-heading">Register Your DID</h2>
      <p>Anchor a W3C Decentralized Identifier on Stellar.</p>
      <button onClick={handleRegister} type="button">
        Register DID
      </button>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
