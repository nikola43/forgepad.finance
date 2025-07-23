'use client'

import { API_ENDPOINT, projectId } from '@/config'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit } from '@reown/appkit/react'
import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { cookieToInitialState, WagmiProvider, type Config } from 'wagmi'
import { Box, CircularProgress, createTheme } from '@mui/material'
import { ThemeProvider } from '@emotion/react'
import * as allNetworks from 'viem/chains'
import { solana, bitcoin } from '@reown/appkit/networks'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { SolanaAdapter } from '@reown/appkit-adapter-solana/react'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import axios from 'axios'
import { ethers } from 'ethers'
import { SWRConfig } from 'swr'
import Loading from '@/components/loading'

const theme = createTheme({
  palette: {
    mode: 'dark',
  },
  typography: {
    fontFamily: "Inter",
  },
  breakpoints: {
    values: {
      xs: 0,
      sm: 800,
      md: 900,
      lg: 1200,
      xl: 1536,
    }
  }
})

// Set up queryClient
const queryClient = new QueryClient()

// Set up metadata
const metadata = {
  name: 'next-reown-appkit',
  description: 'next-reown-appkit',
  url: 'https://github.com/0xonerb/next-reown-appkit-ssr', // origin must match your domain & subdomain
  icons: ['https://avatars.githubusercontent.com/u/179229932']
}

interface Chain {
  name: string,
  network: string,
  chainId: number | string,
  currency: string,
  rpcUrl: string,
  explorerUrl: string,
  contractAddress: `0x${string}`,
  abi: ethers.Interface | ethers.InterfaceAbi,
  virtualEthAmount: number,
  virtualTokenAmount: number,
  totalSupply: number,
  targetMarketCap: number,
  testnet?: boolean,
  pools: string[]
}

interface MainContextProps {
  chains?: Chain[]
}

const MainContext = createContext<MainContextProps | undefined>(undefined);

function ContextProvider({ children }: { children: ReactNode }) {
  const [initialized, setInitialized] = useState(false)
  const [chains, setChains] = useState<any[]>()

  useEffect(() => {
    axios.get(`${API_ENDPOINT}/config`).then(({ data }) => {
      const networks = data.chains.map((chain: any) => {
        if (chain.chainId === 'solana')
          return solana
        else if (chain.chainId === 'bitcoin')
          return bitcoin
        const network = (allNetworks as any)[chain.network]
        return network || null
      }).filter(Boolean)

      if (networks.length === 0) {
        console.error('No valid networks found')
        return
      }

      // const wagmiAdapter = new WagmiAdapter({
      //   ssr: false,
      //   projectId,
      //   networks
      // })
      const ethersAdapter = new EthersAdapter()
      const solanaAdapter = new SolanaAdapter()
      createAppKit({
        adapters: [ethersAdapter],
        projectId,
        networks,
        metadata,
        themeMode: 'dark',
        features: {
          email: false,
          socials: false,
          // emailShowWallets: false,
        },
        enableReconnect: false,
        enableWalletGuide: false,
        themeVariables: {
          '--w3m-accent': '#FFF',
          '--w3m-border-radius-master': '2px'
        }
      })
      setInitialized(true)
      setChains(data.chains)
    }).catch((error) => {
      console.error('Failed to initialize app config:', error)
      setInitialized(true) // Still initialize to prevent infinite loading
    })
    return () => {
      setInitialized(false)
    }
  }, [])

  // const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig as Config, cookies)
  const contextValue: MainContextProps = {
    chains
  }

  if (!initialized)
    return <Loading />

  return (
    <MainContext.Provider value={contextValue}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <SWRConfig>{children}</SWRConfig>
        </ThemeProvider>
      </QueryClientProvider>
    </MainContext.Provider>
  )
}

export default ContextProvider

export const useMainContext = () => {
  const context = useContext(MainContext)

  if (!context) {
    throw new Error('MainContext must be used within a MainContextProvider');
  }
  return context;
}
