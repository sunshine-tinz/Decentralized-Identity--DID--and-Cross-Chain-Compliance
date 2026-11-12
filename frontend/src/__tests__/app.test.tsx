import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const freighterMocks = vi.hoisted(() => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getPublicKey: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));

const sdkMocks = vi.hoisted(() => ({
  register: vi.fn(),
  update: vi.fn(),
  resolve: vi.fn(),
  submitSignedTransaction: vi.fn(),
}));

vi.mock("@stellar/freighter-api", () => ({
  isConnected: freighterMocks.isConnected,
  requestAccess: freighterMocks.requestAccess,
  getPublicKey: freighterMocks.getPublicKey,
  getNetworkDetails: freighterMocks.getNetworkDetails,
  signTransaction: freighterMocks.signTransaction,
}));

vi.mock("@stellar-did/sdk", async () => {
  const actual = await vi.importActual<typeof import("@stellar-did/sdk")>("@stellar-did/sdk");
  class MockDIDClient {
    register = sdkMocks.register;
    update = sdkMocks.update;
    resolve = sdkMocks.resolve;
  }
  return {
    ...actual,
    DIDClient: MockDIDClient,
    submitSignedTransaction: sdkMocks.submitSignedTransaction,
  };
});

import App from "../App";
import { WalletProvider, useWallet } from "../context/WalletContext";
import BridgePage from "../pages/BridgePage";
import RegisterPage from "../pages/RegisterPage";
import VerifyPage from "../pages/VerifyPage";

const VALID_STELLAR_ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

function TestWalletComponent() {
  const { address, isConnected, walletError, connectWallet, disconnectWallet } = useWallet();
  return (
    <div>
      <span data-testid="wallet-status">{isConnected ? "connected" : "disconnected"}</span>
      <span data-testid="wallet-address">{address}</span>
      <span data-testid="wallet-error">{walletError}</span>
      <button onClick={() => connectWallet().catch(() => undefined)}>Connect</button>
      <button onClick={disconnectWallet}>Disconnect</button>
    </div>
  );
}

describe("Frontend Core Components and Wallet/KYC Flows", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    freighterMocks.isConnected.mockResolvedValue(true);
    freighterMocks.requestAccess.mockResolvedValue(VALID_STELLAR_ADDRESS);
    freighterMocks.getPublicKey.mockResolvedValue(VALID_STELLAR_ADDRESS);
    freighterMocks.getNetworkDetails.mockResolvedValue({
      network: "TESTNET",
      networkUrl: "https://horizon-testnet.stellar.org",
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    freighterMocks.signTransaction.mockResolvedValue("AAAA-signed-xdr");
    sdkMocks.register.mockResolvedValue("AAAA-prepared-xdr");
    sdkMocks.update.mockResolvedValue("AAAA-prepared-update-xdr");
    sdkMocks.resolve.mockRejectedValue(new Error("DID not found"));
    sdkMocks.submitSignedTransaction.mockResolvedValue({
      hash: "txhash123",
      status: "SUCCESS",
      ledger: 5599001,
    });
  });

  it("renders main application navigation and routes", () => {
    render(<App />);
    expect(screen.getByText("Stellar DID & Cross-Chain Compliance")).toBeDefined();
    expect(screen.getByText("Register DID")).toBeDefined();
    expect(screen.getByText("KYC Intake")).toBeDefined();
    expect(screen.getByText("Verify Credential")).toBeDefined();
    expect(screen.getByText("Compliance Engine")).toBeDefined();
    expect(screen.getByText("Cross-Chain Bridge")).toBeDefined();
  });

  it("connects and disconnects Freighter wallet without hardcoded fallback", async () => {
    render(
      <WalletProvider>
        <TestWalletComponent />
      </WalletProvider>
    );

    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(screen.getByTestId("wallet-status").textContent).toBe("connected");
    });
    expect(screen.getByTestId("wallet-address").textContent).toBe(VALID_STELLAR_ADDRESS);

    fireEvent.click(screen.getByText("Disconnect"));
    expect(screen.getByTestId("wallet-status").textContent).toBe("disconnected");
    expect(screen.getByTestId("wallet-address").textContent).toBe("");
  });

  it("fails cleanly when Freighter extension is missing", async () => {
    freighterMocks.isConnected.mockResolvedValue(false);

    render(
      <WalletProvider>
        <TestWalletComponent />
      </WalletProvider>
    );

    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(screen.getByTestId("wallet-error").textContent).toMatch(/not installed/i);
    });
    expect(screen.getByTestId("wallet-status").textContent).toBe("disconnected");
    expect(screen.getByTestId("wallet-address").textContent).toBe("");
  });

  it("rejects and surfaces user signature rejection on RegisterPage", async () => {
    freighterMocks.signTransaction.mockRejectedValue(new Error("User declined access"));

    render(
      <WalletProvider>
        <RegisterPage />
      </WalletProvider>
    );

    fireEvent.click(screen.getByText("Connect Freighter"));
    await waitFor(() => expect(screen.getByText(/Disconnect Wallet/i)).toBeDefined());

    fireEvent.click(screen.getByText("Register DID on Stellar"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/User declined access/);
    });
    expect(sdkMocks.submitSignedTransaction).not.toHaveBeenCalled();
  });

  it("surfaces invalid XDR errors during submission", async () => {
    sdkMocks.submitSignedTransaction.mockRejectedValue(
      new Error("Invalid signed transaction XDR: malformed")
    );

    render(
      <WalletProvider>
        <RegisterPage />
      </WalletProvider>
    );

    fireEvent.click(screen.getByText("Connect Freighter"));
    await waitFor(() => expect(screen.getByText(/Disconnect Wallet/i)).toBeDefined());

    fireEvent.click(screen.getByText("Register DID on Stellar"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Invalid signed transaction XDR/);
    });
  });

  it("surfaces failed RPC submission without reporting success", async () => {
    sdkMocks.submitSignedTransaction.mockRejectedValue(
      new Error("Soroban RPC rejected transaction submission (status: ERROR)")
    );

    render(
      <WalletProvider>
        <RegisterPage />
      </WalletProvider>
    );

    fireEvent.click(screen.getByText("Connect Freighter"));
    await waitFor(() => expect(screen.getByText(/Disconnect Wallet/i)).toBeDefined());

    fireEvent.click(screen.getByText("Register DID on Stellar"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/rejected transaction submission/);
    });
    expect(screen.queryByText(/On-Chain DID Document/i)).toBeNull();
  });

  it("confirms DID registration on-chain and updates from resolved state", async () => {
    sdkMocks.resolve
      .mockRejectedValueOnce(new Error("DID not found"))
      .mockResolvedValueOnce({
        id: `did:stellar:${VALID_STELLAR_ADDRESS}`,
        documentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        updatedAt: 5599001,
        active: true,
      });

    render(
      <WalletProvider>
        <RegisterPage />
      </WalletProvider>
    );

    fireEvent.click(screen.getByText("Connect Freighter"));
    await waitFor(() => expect(screen.getByText(/Disconnect Wallet/i)).toBeDefined());

    fireEvent.click(screen.getByText("Register DID on Stellar"));

    await waitFor(() => {
      expect(screen.getByText(/Confirmed Tx Hash:/i)).toBeDefined();
      expect(screen.getAllByText(/txhash123/).length).toBeGreaterThan(0);
      expect(screen.getByText(/On-Chain DID Document/i)).toBeDefined();
    });
    expect(sdkMocks.submitSignedTransaction).toHaveBeenCalledTimes(1);
    expect(sdkMocks.resolve).toHaveBeenCalledTimes(2);
  });

  it("rejects KYC submission with missing subject before calling backend", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      <WalletProvider>
        <VerifyPage />
      </WalletProvider>
    );

    fireEvent.click(screen.getByText("Submit KYC Application"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/valid Stellar subject address/i);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submits KYC request with valid subject and handles backend response shape", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        requestId: "req-uuid-1",
        retrievalToken: "ret-uuid-1",
      }),
    } as Response);

    render(
      <WalletProvider>
        <VerifyPage />
      </WalletProvider>
    );

    const subjectInput = screen.getByLabelText(/Subject Stellar Address/i);
    fireEvent.change(subjectInput, { target: { value: VALID_STELLAR_ADDRESS } });
    fireEvent.click(screen.getByText("Submit KYC Application"));

    await waitFor(() => {
      expect(screen.getAllByText(/req-uuid-1/).length).toBeGreaterThan(0);
      expect(screen.getByText(/ret-uuid-1/)).toBeDefined();
      expect(screen.getByText("pending")).toBeDefined();
    });

    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.subject).toBe(VALID_STELLAR_ADDRESS);
  });

  it("BridgePage computes valid EIP-712 digest", () => {
    render(
      <WalletProvider>
        <BridgePage />
      </WalletProvider>
    );

    fireEvent.click(screen.getByText("Compute EIP-712 Attestation Digest"));

    expect(screen.getByText("Relay Verification Payload")).toBeDefined();
    expect(screen.getByText(/Derived Nonce/i)).toBeDefined();
    expect(screen.getAllByText(/EIP-712 Digest/i).length).toBeGreaterThan(0);
  });
});
