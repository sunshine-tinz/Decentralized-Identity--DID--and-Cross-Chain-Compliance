import React, { useState } from "react";
import { ethers } from "ethers";

export default function BridgePage() {
  const [subject, setSubject] = useState<string>("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  const [receiverAddress, setReceiverAddress] = useState<string>("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  const [policy, setPolicy] = useState<string>("defi_pool");
  const [compliant, setCompliant] = useState<boolean>(true);
  const [eventId, setEventId] = useState<string>("0000000100-0000000001");
  const [chainId, setChainId] = useState<number>(11155111); // Sepolia
  const [digest, setDigest] = useState<string>("");
  const [nonce, setNonce] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  function handleCalculateDigest(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (!ethers.isAddress(subject)) {
        throw new Error("Subject must be a valid EVM address (0x...)");
      }
      if (!ethers.isAddress(receiverAddress)) {
        throw new Error("Receiver must be a valid EVM address (0x...)");
      }

      const calculatedNonce = ethers.keccak256(ethers.toUtf8Bytes(String(eventId)));
      const calculatedDigest = ethers.solidityPackedKeccak256(
        ["address", "string", "bool", "bytes32", "uint256", "address"],
        [subject, policy, compliant, calculatedNonce, chainId, receiverAddress]
      );

      setNonce(calculatedNonce);
      setDigest(calculatedDigest);
      setStatus("EIP-191 payload successfully computed and bound to chainId, receiver, and nonce!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Computation error: ${msg}`);
    }
  }

  return (
    <section aria-labelledby="bridge-heading" style={{ maxWidth: "680px", margin: "0 auto", padding: "1.5rem" }}>
      <h2 id="bridge-heading">Stellar → EVM Cross-Chain Bridge</h2>
      <p>Decodes verified Soroban compliance events, signs EIP-191 attestations, and relays to EVM AttestationReceiver.</p>

      <div style={{ background: "#f5f5f5", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
        <h3>Bridge Architecture</h3>
        <p>1. ComplianceEngine emits <code>compliance::attestation</code> event on Stellar.</p>
        <p>2. StellarListener decodes and validates event id, topics, subject, and compliance flag.</p>
        <p>3. EVMRelayer signs EIP-191 digest: <code>keccak256(abi.encodePacked(subject, policy, compliant, nonce, chainId))</code>.</p>
        <p>4. EVM <code>AttestationReceiver.sol</code> verifies relayer signature and enforces single-use nonce.</p>
      </div>

      <form onSubmit={handleCalculateDigest} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label>
          <strong>Destination Subject EVM Address:</strong>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            style={{ width: "100%", padding: "0.5rem", fontFamily: "monospace" }}
          />
        </label>

        <label>
          <strong>Destination Receiver Contract Address:</strong>
          <input
            type="text"
            value={receiverAddress}
            onChange={(e) => setReceiverAddress(e.target.value)}
            required
            style={{ width: "100%", padding: "0.5rem", fontFamily: "monospace" }}
          />
        </label>

        <label>
          <strong>Policy:</strong>
          <input
            type="text"
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            required
            style={{ width: "100%", padding: "0.5rem" }}
          />
        </label>

        <label>
          <strong>Compliance Flag:</strong>
          <select
            value={compliant ? "true" : "false"}
            onChange={(e) => setCompliant(e.target.value === "true")}
            style={{ width: "100%", padding: "0.5rem" }}
          >
            <option value="true">True (Compliant)</option>
            <option value="false">False (Non-Compliant)</option>
          </select>
        </label>

        <label>
          <strong>Stellar Event ID (Nonce Seed):</strong>
          <input
            type="text"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            required
            style={{ width: "100%", padding: "0.5rem", fontFamily: "monospace" }}
          />
        </label>

        <label>
          <strong>Destination Chain ID:</strong>
          <input
            type="number"
            value={chainId}
            onChange={(e) => setChainId(Number(e.target.value))}
            required
            style={{ width: "100%", padding: "0.5rem" }}
          />
        </label>

        <button
          type="submit"
          style={{ padding: "0.75rem", background: "#1976d2", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
        >
          Compute EIP-191 Attestation Digest
        </button>
      </form>

      {status && (
        <div role="status" style={{ marginTop: "1rem", padding: "0.75rem", background: "#e8f5e9", color: "#2e7d32", borderRadius: "4px" }}>
          {status}
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: "1rem", padding: "0.75rem", background: "#ffebee", color: "#c62828", borderRadius: "4px" }}>
          {error}
        </div>
      )}

      {digest && (
        <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#e8eaf6", borderRadius: "6px" }}>
          <h4>Relay Verification Payload</h4>
          <p><strong>Derived Nonce (bytes32):</strong></p>
          <code style={{ wordBreak: "break-all" }}>{nonce}</code>

          <p style={{ marginTop: "0.5rem" }}><strong>EIP-191 Digest (bytes32):</strong></p>
          <code style={{ wordBreak: "break-all" }}>{digest}</code>
        </div>
      )}
    </section>
  );
}
