import { useState, useEffect, useCallback } from "react";

export const BASE_CHAIN_ID = 84532;
export const SKALE_CHAIN_ID = 974399131;

export type ChainName = "base" | "skale" | "unknown";

function numericToHex(n: number): string {
  return "0x" + n.toString(16);
}

export function useChain() {
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    if (!window.ethereum) return;

    window.ethereum
      .request({ method: "eth_chainId" })
      .then((raw) => {
        setChainId(parseInt(raw as string, 16));
      })
      .catch(() => {});

    const handler = (rawId: unknown) => {
      setChainId(parseInt(rawId as string, 16));
    };

    window.ethereum.on?.("chainChanged", handler as (...args: unknown[]) => void);
    return () => {
      window.ethereum?.removeListener?.("chainChanged", handler as (...args: unknown[]) => void);
    };
  }, []);

  const chainName: ChainName =
    chainId === BASE_CHAIN_ID ? "base" : chainId === SKALE_CHAIN_ID ? "skale" : "unknown";

  const switchToBase = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: numericToHex(BASE_CHAIN_ID) }],
      });
    } catch {
    }
  }, []);

  const switchToSkale = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: numericToHex(SKALE_CHAIN_ID) }],
      });
    } catch (err: any) {
      if (err?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: numericToHex(SKALE_CHAIN_ID),
              chainName: "SKALE Testnet (giant-half-dual)",
              nativeCurrency: { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
              rpcUrls: ["https://testnet.skalenodes.com/v1/giant-half-dual-testnet"],
              blockExplorerUrls: [
                "https://giant-half-dual-testnet.explorer.testnet.skalenodes.com",
              ],
            },
          ],
        });
      }
    }
  }, []);

  return { chainId, chainName, switchToBase, switchToSkale };
}
