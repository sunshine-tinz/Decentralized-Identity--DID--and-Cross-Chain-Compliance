/**
 * Root application component.
 *
 * Routes:
 *  /            → Home (landing)
 *  /register    → DID registration & wallet connection
 *  /verify      → KYC request submission & retrieval
 *  /prove       → Attribute credential verification
 *  /compliance  → Compliance policy evaluation & attestation export
 *  /bridge      → Stellar → EVM attestation relay
 *  /issuer      → Issuer review & approval dashboard
 *  /admin       → Admin panel (issuers, policies, verifiers)
 */

import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { WalletProvider } from "./context/WalletContext";
import RegisterPage from "./pages/RegisterPage";
import VerifyPage from "./pages/VerifyPage";
import ProvePage from "./pages/ProvePage";
import CompliancePage from "./pages/CompliancePage";
import BridgePage from "./pages/BridgePage";
import AdminPage from "./pages/AdminPage";
import IssuerPage from "./pages/IssuerPage";

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <header style={{ borderBottom: "1px solid #e0e0e0", background: "#fafafa" }}>
          <div style={{ maxWidth: "960px", margin: "0 auto", padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h1 style={{ margin: 0, fontSize: "1.25rem", color: "#1976d2" }}>
              Stellar DID & Cross-Chain Compliance
            </h1>
            <span style={{ fontSize: "12px", background: "#e3f2fd", color: "#0d47a1", padding: "4px 8px", borderRadius: "12px" }}>
              Stellar Testnet
            </span>
          </div>
          <nav aria-label="Main navigation" style={{ maxWidth: "960px", margin: "0 auto", padding: "0 1rem 0.75rem", display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "14px" }}>
            <Link to="/">Home</Link>
            <Link to="/register">Register DID</Link>
            <Link to="/verify">KYC Intake</Link>
            <Link to="/prove">Verify Credential</Link>
            <Link to="/compliance">Compliance Engine</Link>
            <Link to="/bridge">Cross-Chain Bridge</Link>
            <Link to="/issuer">Issuer Portal</Link>
            <Link to="/admin">Admin</Link>
          </nav>
        </header>

        <main style={{ maxWidth: "960px", margin: "0 auto", padding: "1rem" }}>
          <Routes>
            <Route
              path="/"
              element={
                <section style={{ textAlign: "center", padding: "2rem 1rem" }}>
                  <h2>Decentralized Identity & Cross-Chain Compliance Architecture</h2>
                  <p style={{ maxWidth: "600px", margin: "0 auto 1.5rem", color: "#555" }}>
                    W3C-anchored DIDs, verifiable issuer-attested credentials with live expiry & revocation, live compliance policy evaluation, and cryptographic relay to EVM chains.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", textAlign: "left" }}>
                    <div style={{ border: "1px solid #ddd", borderRadius: "6px", padding: "1rem" }}>
                      <h3>1. Register DID</h3>
                      <p>Anchor your controller key as a W3C-compliant <code>did:stellar:&lt;address&gt;</code>.</p>
                      <Link to="/register">Open Registration →</Link>
                    </div>
                    <div style={{ border: "1px solid #ddd", borderRadius: "6px", padding: "1rem" }}>
                      <h3>2. Request KYC</h3>
                      <p>Submit documents to trusted issuers with single-use token retrieval.</p>
                      <Link to="/verify">Request KYC →</Link>
                    </div>
                    <div style={{ border: "1px solid #ddd", borderRadius: "6px", padding: "1rem" }}>
                      <h3>3. Evaluate Compliance</h3>
                      <p>Live on-chain evaluation against named policies (e.g. <code>defi_pool</code>).</p>
                      <Link to="/compliance">Check Compliance →</Link>
                    </div>
                    <div style={{ border: "1px solid #ddd", borderRadius: "6px", padding: "1rem" }}>
                      <h3>4. Cross-Chain Bridge</h3>
                      <p>Export attestation and relay to EVM <code>AttestationReceiver.sol</code>.</p>
                      <Link to="/bridge">Bridge Attestation →</Link>
                    </div>
                  </div>
                </section>
              }
            />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="/prove" element={<ProvePage />} />
            <Route path="/compliance" element={<CompliancePage />} />
            <Route path="/bridge" element={<BridgePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/issuer" element={<IssuerPage />} />
          </Routes>
        </main>
      </BrowserRouter>
    </WalletProvider>
  );
}
