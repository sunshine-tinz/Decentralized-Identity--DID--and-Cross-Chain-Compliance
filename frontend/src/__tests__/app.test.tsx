import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../App";
import { WalletProvider, useWallet } from "../context/WalletContext";
import BridgePage from "../pages/BridgePage";
import RegisterPage from "../pages/RegisterPage";
import VerifyPage from "../pages/VerifyPage";

function TestWalletComponent() {
  const { address, isConnected, connectWallet, disconnectWallet } = useWallet();
  return (
    <div>
      <span data-testid="wallet-status">{isConnected ? "connected" : "disconnected"}</span>
      <span data-testid="wallet-address">{address}</span>
      <button onClick={() => connectWallet("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5")}>
        Connect
      </button>
      <button onClick={disconnectWallet}>Disconnect</button>
    </div>
  );
}

describe("Frontend Core Components and Flow", () => {
  it("renders main application navigation and routes", () => {
    render(<App />);
    expect(screen.getByText("Stellar DID & Cross-Chain Compliance")).toBeDefined();
    expect(screen.getByText("Register DID")).toBeDefined();
    expect(screen.getByText("KYC Intake")).toBeDefined();
    expect(screen.getByText("Verify Credential")).toBeDefined();
    expect(screen.getByText("Compliance Engine")).toBeDefined();
    expect(screen.getByText("Cross-Chain Bridge")).toBeDefined();
  });

  it("WalletContext connects and disconnects correctly", () => {
    render(
      <WalletProvider>
        <TestWalletComponent />
      </WalletProvider>
    );

    const connectBtn = screen.getByText("Connect");
    fireEvent.click(connectBtn);

    expect(screen.getByTestId("wallet-status").textContent).toBe("connected");
    expect(screen.getByTestId("wallet-address").textContent).toContain("GBBD47");

    const disconnectBtn = screen.getByText("Disconnect");
    fireEvent.click(disconnectBtn);

    expect(screen.getByTestId("wallet-status").textContent).toBe("disconnected");
    expect(screen.getByTestId("wallet-address").textContent).toBe("");
  });

  it("RegisterPage validates document hash length and format", () => {
    render(
      <WalletProvider>
        <RegisterPage />
      </WalletProvider>
    );

    expect(screen.getByText("Register & Manage Your DID")).toBeDefined();
    const hashInput = screen.getByLabelText(/Off-chain Document SHA-256 Hash/i) as HTMLInputElement;
    expect(hashInput.value.length).toBe(64);
  });

  it("VerifyPage renders required compliance attribute options", () => {
    render(
      <WalletProvider>
        <VerifyPage />
      </WalletProvider>
    );

    expect(screen.getByText("Request KYC Verification")).toBeDefined();
    expect(screen.getByText("kyc_passed")).toBeDefined();
    expect(screen.getByText("accredited_investor")).toBeDefined();
    expect(screen.getByText("not_sanctioned")).toBeDefined();
    expect(screen.getByText("over_18")).toBeDefined();
  });

  it("BridgePage computes valid EIP-191 digest", () => {
    render(
      <WalletProvider>
        <BridgePage />
      </WalletProvider>
    );

    const computeBtn = screen.getByText("Compute EIP-191 Attestation Digest");
    fireEvent.click(computeBtn);

    expect(screen.getByText("Relay Verification Payload")).toBeDefined();
    expect(screen.getByText(/Derived Nonce/i)).toBeDefined();
    expect(screen.getAllByText(/EIP-191 Digest/i).length).toBeGreaterThan(0);
  });
});
