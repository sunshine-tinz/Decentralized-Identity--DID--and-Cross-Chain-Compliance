import React, { createContext, useContext, useState, useEffect } from "react";
import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  getPublicKey as freighterGetPublicKey,
  getNetworkDetails as freighterGetNetworkDetails,
  signTransaction as freighterSignTransaction,
} from "@stellar/freighter-api";
import { StrKey } from "@stellar/stellar-sdk";
import { getConfig } from "../config";

export interface WalletContextType {
  address: string;
  isConnected: boolean;
  isFreighter: boolean;
  connecting: boolean;
  walletError: string;
  connectWallet: () => Promise<string>;
  disconnectWallet: () => void;
  signTransaction: (xdr: string) => Promise<string>;
  network: string;
  networkPassphrase: string;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const STORAGE_KEY = "stellar_did_wallet_address";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  const [address, setAddress] = useState<string>("");
  const [isFreighter, setIsFreighter] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [walletError, setWalletError] = useState<string>("");
  const [network, setNetwork] = useState<string>("Stellar Testnet");

  useEffect(() => {
    let active = true;
    async function detectFreighter() {
      try {
        const installed = await freighterIsConnected();
        if (!active) return;
        setIsFreighter(Boolean(installed));
        if (installed) {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved && StrKey.isValidEd25519PublicKey(saved)) {
            const pk = await freighterGetPublicKey();
            if (active && pk && pk === saved) {
              setAddress(pk);
            }
          }
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        if (active) setIsFreighter(false);
      }
    }
    detectFreighter();
    return () => {
      active = false;
    };
  }, []);

  const connectWallet = async (): Promise<string> => {
    setConnecting(true);
    setWalletError("");
    try {
      const installed = await freighterIsConnected();
      setIsFreighter(Boolean(installed));
      if (!installed) {
        const msg =
          "Freighter wallet extension is not installed or unavailable. Please install Freighter to connect.";
        setWalletError(msg);
        throw new Error(msg);
      }

      const pubKey = (await freighterRequestAccess()) || (await freighterGetPublicKey());
      if (!pubKey || !StrKey.isValidEd25519PublicKey(pubKey)) {
        const msg = "Wallet connection rejected or returned an invalid Stellar address.";
        setWalletError(msg);
        throw new Error(msg);
      }

      try {
        const details = await freighterGetNetworkDetails();
        if (details?.network) {
          setNetwork(details.network);
        }
        if (
          details?.networkPassphrase &&
          details.networkPassphrase !== config.networkPassphrase
        ) {
          const msg = `Freighter is on "${details.networkPassphrase}", expected "${config.networkPassphrase}".`;
          setWalletError(msg);
          throw new Error(msg);
        }
      } catch (netErr) {
        if (netErr instanceof Error && netErr.message.startsWith("Freighter is on")) {
          throw netErr;
        }
      }

      setAddress(pubKey);
      localStorage.setItem(STORAGE_KEY, pubKey);
      return pubKey;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setWalletError(msg);
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      setConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setAddress("");
    setWalletError("");
    localStorage.removeItem(STORAGE_KEY);
  };

  const signTransaction = async (xdr: string): Promise<string> => {
    if (!xdr || typeof xdr !== "string") {
      throw new Error("Prepared transaction XDR is required for signing");
    }

    const installed = await freighterIsConnected();
    if (!installed) {
      throw new Error("Freighter wallet extension is not installed or unavailable.");
    }
    if (!address) {
      throw new Error("Connect your Freighter wallet before signing transactions.");
    }

    const signed = await freighterSignTransaction(xdr, {
      networkPassphrase: config.networkPassphrase,
      accountToSign: address,
    });

    if (!signed || typeof signed !== "string") {
      throw new Error("Transaction signing was rejected or returned empty XDR.");
    }
    return signed;
  };

  return (
    <WalletContext.Provider
      value={{
        address,
        isConnected: Boolean(address),
        isFreighter,
        connecting,
        walletError,
        connectWallet,
        disconnectWallet,
        signTransaction,
        network,
        networkPassphrase: config.networkPassphrase,
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
