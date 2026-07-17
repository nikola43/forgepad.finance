"use client";

import { API_ENDPOINT } from "@/config";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppKit, createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createTheme } from "@mui/material";
import { ThemeProvider } from "@emotion/react";
import axios from "axios";
import { ethers } from "ethers";
import { SWRConfig } from "swr";
import Loading from "@/components/loading";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { SolanaAdapter } from "@reown/appkit-adapter-solana/react";
import {
  solana,
  bitcoin,
  base,
  bsc,
  bscTestnet,
  defineChain,
} from "@reown/appkit/networks";
import { projectId } from "@/config";
import { WagmiProvider } from "wagmi";

// BNB Smart Chain (BNB gas token). Built from appkit's ready-made `bsc` network
// so the canonical metadata (name, BNB nativeCurrency, BscScan, multicall3)
// comes from upstream; we override the RPC/explorer so they can point at a
// private node, and the chain id so a localnet can run beside real BSC.
// 56 = real BSC mainnet, 97 = the canonical BSC testnet, any other id = a local
// anvil fork. A localnet MUST override the id: an anvil BSC fork still reports
// whatever chain id it was started with, and if that id is 56 the wallet matches
// it to its own built-in BSC network and silently routes transactions to MAINNET
// instead of the fork. A distinct id keeps real funds out of reach.
const bscChainId = Number(process.env.NEXT_PUBLIC_BSC_CHAIN_ID ?? 56);
const isBscTestnet = bscChainId === 97;
const isLocalnet = bscChainId !== 56 && !isBscTestnet;

// Build on the matching upstream network so canonical metadata (BNB currency,
// explorer, multicall3) is correct for the target chain.
const baseChain = isBscTestnet ? bscTestnet : bsc;

const bscRpcUrl =
  process.env.NEXT_PUBLIC_BSC_RPC_URL ||
  (isBscTestnet
    ? "https://bsc-testnet-rpc.publicnode.com"
    : "https://bsc-dataseed.bnbchain.org");
const bscExplorerUrl =
  process.env.NEXT_PUBLIC_BSC_EXPLORER_URL ||
  (isBscTestnet ? "https://testnet.bscscan.com" : "https://bscscan.com");

const ethNetwork = defineChain({
  ...baseChain,
  id: bscChainId,
  name: isBscTestnet
    ? "BNB Smart Chain Testnet"
    : isLocalnet
      ? `BNB Smart Chain (localnet ${bscChainId})`
      : bsc.name,
  // The upstream export is a plain viem chain; defineChain needs the CAIP fields
  // added on top.
  chainNamespace: "eip155",
  caipNetworkId: `eip155:${bscChainId}`,
  rpcUrls: {
    ...baseChain.rpcUrls,
    default: { http: [bscRpcUrl] },
  },
  blockExplorers: {
    ...baseChain.blockExplorers,
    default: {
      ...baseChain.blockExplorers?.default,
      name: baseChain.blockExplorers?.default?.name ?? "BscScan",
      url: bscExplorerUrl,
    },
  },
  // Real BSC/testnet have a real explorer + multicall3; a local fork has neither
  // of its own, but the inherited multicall3 address exists in forked state.
  testnet: isLocalnet || isBscTestnet,
});

const theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#131208", paper: "#1E1C10" },
    primary: { main: "#BFD143", contrastText: "#131208" },
    secondary: { main: "#C74B8E", contrastText: "#131208" },
    success: { main: "#3FA968" },
    error: { main: "#D64545" },
    warning: { main: "#E8B93B" },
    text: { primary: "#EAE6DA", secondary: "#8C8C85" },
  },
  typography: {
    fontFamily: "'Space Grotesk', Helvetica, Arial, sans-serif",
    h1: { fontFamily: "'Unbounded', 'Arial Black', sans-serif", fontWeight: 900 },
    h2: { fontFamily: "'Unbounded', 'Arial Black', sans-serif", fontWeight: 700 },
    h3: { fontFamily: "'Unbounded', 'Arial Black', sans-serif", fontWeight: 700 },
    h4: { fontFamily: "'Unbounded', 'Arial Black', sans-serif", fontWeight: 700 },
    h5: { fontFamily: "'Unbounded', 'Arial Black', sans-serif", fontWeight: 700 },
    h6: { fontFamily: "'Unbounded', 'Arial Black', sans-serif", fontWeight: 700 },
  },
  breakpoints: {
    values: {
      xs: 0,
      sm: 800,
      md: 900,
      lg: 1200,
      xl: 1536,
    },
  },
});

// Set up queryClient
const queryClient = new QueryClient();

// Set up metadata
// const metadata = {
//   name: 'Fyuz',
//   description: 'Two icons enter. One market leaves.',
//   url: 'https://fyuz.fun', // origin must match your domain & subdomain
//   icons: ['https://fyuz.fun/favicon.ico']
// }

interface Chain {
  name: string;
  network: string;
  chainId: number | string;
  currency: string;
  rpcUrl: string;
  explorerUrl: string;
  contractAddress: `0x${string}`;
  abi: ethers.Interface | ethers.InterfaceAbi;
  virtualEthAmount: number;
  virtualTokenAmount: number;
  totalSupply: number;
  targetMarketCap: number;
  testnet?: boolean;
  pools: string[];
}

interface MainContextProps {
  chains?: Chain[];
  appKit?: AppKit;
}

// localhost.id = 56;

const wagmiAdapter = new WagmiAdapter({
  ssr: false,
  projectId,
  networks: [ethNetwork],
  // networks: [localhost, mainnet, base, bsc, solana]
});
const ethersAdapter = new EthersAdapter();
const solanaAdapter = new SolanaAdapter();
const appKit = createAppKit({
  adapters: [wagmiAdapter, solanaAdapter],
  projectId,
  networks: [ethNetwork],
  // networks: [localhost, mainnet, base, bsc, solana],
  // metadata,
  themeMode: "dark",
  // features: {
  //   email: false,
  //   socials: false,
  //   // emailShowWallets: false,
  // },
  enableReconnect: true,
  enableWalletGuide: false,
  defaultAccountTypes: { eip155: "eoa", solana: "eoa" },
  themeVariables: {
    "--w3m-accent": "#BFD143",
    "--w3m-font-family": "'Space Grotesk', Helvetica, Arial, sans-serif",
    "--w3m-border-radius-master": "2px",
  },
});

const MainContext = createContext<MainContextProps | undefined>(undefined);

function ContextProvider({ children }: { children: ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [chains, setChains] = useState<any[]>();

  useEffect(() => {
    axios
      .get(`${API_ENDPOINT}/config`)
      .then(({ data }) => {
        // const networks = data.chains.map((chain: any) => {
        //   if (chain.chainId === 'solana')
        //     return solana
        //   else if (chain.chainId === 'bitcoin')
        //     return bitcoin
        //   const network = defineChain({
        //     id: chain.chainId,
        //     caipNetworkId: `eip155:${chain.chainId}`,
        //     chainNamespace: 'eip155',
        //     name: chain.name,
        //     nativeCurrency: {
        //       decimals: 18,
        //       name: 'Ether',
        //       symbol: chain.currency,
        //     },
        //     rpcUrls: {
        //       default: {
        //         http: [chain.rpcUrl],
        //       },
        //     },
        //     blockExplorers: {
        //       default: { name: 'Explorer', url: chain.explorerUrl },
        //     },
        //   })
        //   return network || null
        // }).filter(Boolean)

        // if (networks.length === 0) {
        //   console.error('No valid networks found')
        //   return
        // }

        // const wagmiAdapter = new WagmiAdapter({
        //   ssr: false,
        //   projectId,
        //   networks
        // })
        // const ethersAdapter = new EthersAdapter()
        // const solanaAdapter = new SolanaAdapter()
        // const modal = createAppKit({
        //   adapters: [ethersAdapter, solanaAdapter],
        //   projectId,
        //   networks,
        //   metadata,
        //   themeMode: 'dark',
        //   features: {
        //     email: false,
        //     socials: false,
        //     // emailShowWallets: false,
        //   },
        //   enableReconnect: false,
        //   enableWalletGuide: false,
        //   defaultAccountTypes: { eip155: 'eoa', solana: 'eoa' },
        //   themeVariables: {
        //     '--w3m-accent': '#FFF',
        //     '--w3m-border-radius-master': '2px'
        //   }
        // })
        // setAppKit(modal)
        setInitialized(true);
        setChains(data.chains);
      })
      .catch((error) => {
        console.error("Failed to initialize app config:", error);
        setInitialized(true); // Still initialize to prevent infinite loading
      });
    return () => {
      setInitialized(false);
    };
  }, []);

  // const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig as Config, cookies)
  const contextValue: MainContextProps = {
    chains,
    appKit,
  };

  if (!initialized || !appKit) return <Loading />;

  return (
    <MainContext.Provider value={contextValue}>
      <WagmiProvider config={wagmiAdapter.wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider theme={theme}>
            <SWRConfig>{children}</SWRConfig>
          </ThemeProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </MainContext.Provider>
  );
}

export default ContextProvider;

export const useMainContext = () => {
  const context = useContext(MainContext);

  if (!context) {
    throw new Error("MainContext must be used within a MainContextProvider");
  }
  return context;
};
