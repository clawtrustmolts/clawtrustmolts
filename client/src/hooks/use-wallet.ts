import { useState, useEffect, useCallback, useRef } from "react";

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export type WalletModalState = "connecting" | "signing" | "not-found" | "error" | null;

const SIG_STORAGE_KEY = "ct_sig";
const SIG_TTL_MS = 24 * 60 * 60 * 1000;

function getStoredSig(): { address: string; sig: string; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(SIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > SIG_TTL_MS) {
      localStorage.removeItem(SIG_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function detectEthereum(timeoutMs = 1200): Promise<boolean> {
  if (window.ethereum) return true;
  return new Promise((resolve) => {
    const interval = 100;
    const attempts = Math.ceil(timeoutMs / interval);
    let count = 0;
    const id = setInterval(() => {
      if (window.ethereum) { clearInterval(id); resolve(true); return; }
      if (++count >= attempts) { clearInterval(id); resolve(false); }
    }, interval);
  });
}

export function useWallet() {
  const [wallet, setWallet] = useState<string>(() => localStorage.getItem("connectedWallet") || "");
  const [isConnecting, setIsConnecting] = useState(false);
  const [modalState, setModalState] = useState<WalletModalState>(null);
  const [modalError, setModalError] = useState<string>("");
  const connectingRef = useRef(false);

  const closeModal = useCallback(() => {
    setModalState(null);
    setModalError("");
    setIsConnecting(false);
    connectingRef.current = false;
  }, []);

  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setIsConnecting(true);
    setModalError("");
    setModalState("connecting");

    try {
      const found = await detectEthereum();
      if (!found) {
        setModalState("not-found");
        setIsConnecting(false);
        connectingRef.current = false;
        return;
      }

      const accounts = (await window.ethereum!.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts || accounts.length === 0) {
        setModalState("error");
        setModalError("No accounts returned. Please unlock MetaMask and try again.");
        setIsConnecting(false);
        connectingRef.current = false;
        return;
      }

      const address = accounts[0];

      const stored = getStoredSig();
      if (!stored || stored.address.toLowerCase() !== address.toLowerCase()) {
        setModalState("signing");
        const nonce = Date.now();
        const message = `Welcome to ClawTrust 🦞\n\nSigning this message verifies your wallet ownership.\nNo gas required. No transaction is sent.\n\nNonce: ${nonce}\nChain: Base Sepolia (84532)`;
        try {
          const sig = await window.ethereum!.request({
            method: "personal_sign",
            params: [message, address],
          }) as string;
          localStorage.setItem(SIG_STORAGE_KEY, JSON.stringify({ address, sig, timestamp: nonce }));
        } catch (sigErr: any) {
          if (sigErr?.code === 4001) {
            setModalState("error");
            setModalError("Signature declined. Please sign to verify wallet ownership.");
            setIsConnecting(false);
            connectingRef.current = false;
            return;
          }
        }
      }

      setWallet(address);
      localStorage.setItem("connectedWallet", address);
      setModalState(null);
    } catch (err: any) {
      if (err?.code === 4001) {
        setModalState("error");
        setModalError("Connection rejected. Please approve the MetaMask request.");
      } else {
        setModalState("error");
        setModalError(err?.message || "Wallet connection failed. Please try again.");
      }
    } finally {
      setIsConnecting(false);
      connectingRef.current = false;
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet("");
    localStorage.removeItem("connectedWallet");
    localStorage.removeItem(SIG_STORAGE_KEY);
    setModalState(null);
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
    modalState,
    modalError,
    closeModal,
  };
}
