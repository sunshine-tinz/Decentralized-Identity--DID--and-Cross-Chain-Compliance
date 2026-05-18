/**
 * Root application component.
 *
 * Routes:
 *  /          → Home (landing)
 *  /register  → DID registration
 *  /verify    → KYC request submission
 *  /prove     → Attribute proof (ring signature)
 *  /admin     → Admin panel (issuer management)
 *  /issuer    → Issuer dashboard (approve/reject requests)
 *
 * TODO for contributors:
 *  - Add wallet connection (Freighter / Albedo) via @stellar/wallet-sdk
 *  - Add global auth context (connected wallet address)
 *  - Add toast notifications for transaction status
 */

import React from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import RegisterPage from "./pages/RegisterPage";
import VerifyPage from "./pages/VerifyPage";
import ProvePage from "./pages/ProvePage";
import AdminPage from "./pages/AdminPage";
import IssuerPage from "./pages/IssuerPage";

export default function App() {
  return (
    <BrowserRouter>
      <nav aria-label="Main navigation">
        <Link to="/">Home</Link>
        <Link to="/register">Register DID</Link>
        <Link to="/verify">Get KYC</Link>
        <Link to="/prove">Prove Attribute</Link>
        <Link to="/issuer">Issuer Dashboard</Link>
        <Link to="/admin">Admin</Link>
      </nav>

      <main>
        <Routes>
          <Route path="/" element={<h1>Stellar DID & Compliance</h1>} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/prove" element={<ProvePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/issuer" element={<IssuerPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
