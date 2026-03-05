import { useState, useEffect, useCallback } from "react";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export function useWallet() {
  const [wallet, setWallet] = useState<string>(() => localStorage.getItem("connectedWallet") || "");
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert("MetaMask is not installed. Please install MetaMask to connect your wallet.");
      return;
    }
    setIsConnecting(true);
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts && accounts[0]) {
        setWallet(accounts[0]);
        localStorage.setItem("connectedWallet", accounts[0]);
      }
    } catch (err: any) {
      console.error("Wallet connection failed:", err.message);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet("");
    localStorage.removeItem("connectedWallet");
  }, []);

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const handleAccountsChanged = (accounts: unknown) => {
      const list = accounts as string[];
      if (!list || list.length === 0) {
        disconnect();
      } else {
        setWallet(list[0]);
        localStorage.setItem("connectedWallet", list[0]);
      }
    };
    window.ethereum.on("accountsChanged", handleAccountsChanged);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
    };
  }, [disconnect]);

  return {
    wallet,
    connect,
    disconnect,
    isConnecting,
    isConnected: !!wallet,
    shortAddress: wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "",
  };
}
