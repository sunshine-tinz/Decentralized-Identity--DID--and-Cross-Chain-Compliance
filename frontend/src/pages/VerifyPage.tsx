/**
 * VerifyPage — KYC Request Submission
 *
 * User selects an issuer, chooses attributes to verify, and submits
 * personal information + document photo for off-chain review.
 *
 * TODO for contributors:
 *  1. Fetch registered issuers from the KYC Issuer service GET /api/issuer/list
 *  2. Add webcam capture for document photo (see jamesbachini.com reference)
 *  3. POST to /api/kyc/request and poll /api/kyc/status/:id
 *  4. On approval, retrieve credential from /api/kyc/credential/:userId
 *  5. Store credential in localStorage (optionally AES-GCM encrypted)
 */

import React, { useState } from "react";

const AVAILABLE_ATTRIBUTES = ["kyc_passed", "accredited_investor", "not_sanctioned", "over_18"];

export default function VerifyPage() {
  const [selectedAttrs, setSelectedAttrs] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");

  function toggleAttr(attr: string) {
    setSelectedAttrs((prev) =>
      prev.includes(attr) ? prev.filter((a) => a !== attr) : [...prev, attr]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Submitting KYC request...");
    // TODO: POST to /api/kyc/request
    // TODO: poll for credential
    setStatus("Not yet implemented — see services/kyc-issuer/src/routes/kyc.js");
  }

  return (
    <section aria-labelledby="verify-heading">
      <h2 id="verify-heading">Request KYC Verification</h2>
      <form onSubmit={handleSubmit}>
        <fieldset>
          <legend>Select attributes to verify</legend>
          {AVAILABLE_ATTRIBUTES.map((attr) => (
            <label key={attr}>
              <input
                type="checkbox"
                checked={selectedAttrs.includes(attr)}
                onChange={() => toggleAttr(attr)}
              />
              {attr}
            </label>
          ))}
        </fieldset>
        {/* TODO: add personal info fields and document capture */}
        <button type="submit" disabled={selectedAttrs.length === 0}>
          Submit KYC Request
        </button>
      </form>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
