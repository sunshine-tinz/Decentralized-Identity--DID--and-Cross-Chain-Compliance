/**
 * ProvePage — Attribute Proof via Ring Signature
 *
 * User loads their credential from localStorage and proves an attribute
 * on-chain without revealing their identity.
 *
 * TODO for contributors:
 *  1. Load credential from localStorage (decrypt if encrypted)
 *  2. Let user select an attribute to prove
 *  3. Generate a challenge (attribute + timestamp + random nonce)
 *  4. Call VCClient.generateRingSignature() client-side
 *  5. Submit proof via VCClient.verifyCredential()
 *  6. Display proof count from contract
 */

import React, { useState } from "react";

export default function ProvePage() {
  const [attribute, setAttribute] = useState<string>("");
  const [result, setResult] = useState<boolean | null>(null);

  async function handleProve(e: React.FormEvent) {
    e.preventDefault();
    // TODO: load credential from localStorage
    // TODO: call VCClient.generateRingSignature()
    // TODO: call VCClient.verifyCredential()
    setResult(null);
    alert("Not yet implemented — see sdk/src/clients/VCClient.ts");
  }

  return (
    <section aria-labelledby="prove-heading">
      <h2 id="prove-heading">Prove an Attribute</h2>
      <form onSubmit={handleProve}>
        <label>
          Attribute
          <input
            value={attribute}
            onChange={(e) => setAttribute(e.target.value)}
            placeholder="e.g. kyc_passed"
          />
        </label>
        <button type="submit" disabled={!attribute}>
          Generate & Submit Proof
        </button>
      </form>
      {result !== null && (
        <p role="status">{result ? "✅ Proof verified!" : "❌ Proof failed"}</p>
      )}
    </section>
  );
}
