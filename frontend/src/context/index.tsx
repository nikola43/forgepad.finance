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
import {
  bsc,
  defineChain,
} from "@reown/appkit/networks";
import { projectId } from "@/config";
import { WagmiProvider } from "wagmi";

const robinhoodChainId = Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID ?? 4663);
const robinhoodRpcUrl = process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const robinhoodExplorerUrl = process.env.NEXT_PUBLIC_ROBINHOOD_EXPLORER_URL || "https://robinhoodchain.blockscout.com";

const robinhoodNetwork = defineChain({
  id: robinhoodChainId,
  name: "Robinhood Chain",
  chainNamespace: "eip155",
  caipNetworkId: `eip155:${robinhoodChainId}`,
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: { http: [robinhoodRpcUrl] },
  },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: robinhoodExplorerUrl },
  },
  testnet: false,
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
  networks: [bsc, robinhoodNetwork],
});
const appKit = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [bsc, robinhoodNetwork],
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
  defaultAccountTypes: { eip155: "eoa" },
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
