import React, { createContext, useContext, useState, useEffect } from "react";

export interface WalletContextType {
  address: string;
  isConnected: boolean;
  isFreighter: boolean;
  connectWallet: (customAddress?: string) => Promise<string>;
  disconnectWallet: () => void;
  signTransaction: (xdr: string) => Promise<string>;
  network: string;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const STORAGE_KEY = "stellar_did_wallet_address";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || "";
  });
  const [isFreighter, setIsFreighter] = useState<boolean>(false);
  const network = "Stellar Testnet";

  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { freighterApi?: unknown }).freighterApi) {
      setIsFreighter(true);
    }
  }, []);

  const connectWallet = async (customAddress?: string): Promise<string> => {
    if (customAddress && customAddress.startsWith("G") && customAddress.length === 56) {
      setAddress(customAddress);
      localStorage.setItem(STORAGE_KEY, customAddress);
      return customAddress;
    }

    const freighter = (window as unknown as {
      freighterApi?: {
        getPublicKey: () => Promise<string>;
        isConnected: () => Promise<boolean>;
      };
    }).freighterApi;

    if (freighter) {
      try {
        const pubKey = await freighter.getPublicKey();
        if (pubKey) {
          setAddress(pubKey);
          localStorage.setItem(STORAGE_KEY, pubKey);
          return pubKey;
        }
      } catch (err) {
        console.warn("Freighter connection cancelled or failed:", err);
      }
    }

    // Default testnet address if no Freighter or cancelled
    const fallback = customAddress || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    setAddress(fallback);
    localStorage.setItem(STORAGE_KEY, fallback);
    return fallback;
  };

  const disconnectWallet = () => {
    setAddress("");
    localStorage.removeItem(STORAGE_KEY);
  };

  const signTransaction = async (xdr: string): Promise<string> => {
    const freighter = (window as unknown as {
      freighterApi?: {
        signTransaction: (xdr: string, options?: { networkPassphrase?: string }) => Promise<string>;
      };
    }).freighterApi;

    if (freighter) {
      return freighter.signTransaction(xdr, {
        networkPassphrase: "Test SDF Network ; September 2015",
      });
    }

    // In simulated/fallback mode, return simulated signed XDR
    return xdr;
  };

  return (
    <WalletContext.Provider
      value={{
        address,
        isConnected: Boolean(address),
        isFreighter,
        connectWallet,
        disconnectWallet,
        signTransaction,
        network,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
