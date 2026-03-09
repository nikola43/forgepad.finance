import useSWR from "swr";
import { BrowserProvider, ethers } from "ethers";
import { type Provider as EVMProvider, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { API_ENDPOINT, isDevEnv } from "@/config";
import axios from "axios";
import { useEffect, useRef } from "react";

const LOCAL_RPC = "http://127.0.0.1:8545";

export function useUserInfo() {
    const { address } = useAppKitAccount()

    const { data: userInfo, mutate } = useSWR(
      address ? '/info/user' : undefined,
      async () => {
        if (!address) return { balance: 0 } as any
        try {
          // In dev mode, query local Anvil directly; in prod, use wallet's provider
          const provider = isDevEnv
            ? new ethers.JsonRpcProvider(LOCAL_RPC)
            : new ethers.BrowserProvider((window as any).ethereum)
          const balanceWei = await provider.getBalance(address)
          const balanceInEther = ethers.formatEther(balanceWei)
          console.log('Balance:', balanceInEther, 'BNB')
          return {
            balance: Number(balanceInEther)
          } as any
        } catch (error) {
          console.error('Error fetching balance:', error)
          return {
            balance: 0
          } as any
        }
      }, {
        refreshInterval: 5000,
      }
    )
    return {
        userInfo, setUserInfo: mutate
    }
}

/** Fetch the backend user record for the connected wallet */
export function useAccount() {
    const { address, isConnected } = useAppKitAccount()
    const { walletProvider } = useAppKitProvider<EVMProvider>("eip155")
    const registeredRef = useRef(false)

    const { data: account, mutate } = useSWR(
        address ? ['/account', address] : null,
        async () => {
            try {
                const { data } = await axios.get(`${API_ENDPOINT}/users`, {
                    params: { userAddress: address }
                })
                return data
            } catch (err: any) {
                if (err?.response?.status === 404) return null
                throw err
            }
        },
        { revalidateOnFocus: false }
    )

    // Auto-register on first connect if user doesn't exist
    useEffect(() => {
        if (!isConnected || !address || !walletProvider || registeredRef.current) return
        // account === undefined means SWR is still loading
        if (account === undefined) return
        // account is a valid object means user exists
        if (account) return

        registeredRef.current = true
        ;(async () => {
            try {
                const provider = new BrowserProvider(walletProvider)
                const signer = await provider.getSigner()
                const msg = `Register on Forgepad\n${address}\n${Date.now()}`
                const signature = await signer.signMessage(msg)
                await axios.post(`${API_ENDPOINT}/users`, {
                    user: { username: '', bio: '', avatar: '' },
                    signature,
                    msg
                })
                mutate()
            } catch (err) {
                console.error('Auto-register failed:', err)
                registeredRef.current = false
            }
        })()
    }, [isConnected, address, walletProvider, account, mutate])

    return { account, reloadAccount: mutate }
}

/** Fetch a full user profile (holdings, tokens, followers, etc.) */
export function useUserProfile(profileAddress?: string) {
    const { data: profile, mutate } = useSWR(
        profileAddress ? ['/users/profile', profileAddress] : null,
        async () => {
            let user = null
            try {
                const res = await axios.get(`${API_ENDPOINT}/users`, { params: { userAddress: profileAddress } })
                user = res.data
            } catch (err: any) {
                if (err?.response?.status !== 404) throw err
            }
            let profileData = { helds: [], replies: [], tokens: [], followers: [], followees: [], referrals: 0, points: null }
            try {
                const res = await axios.get(`${API_ENDPOINT}/users/profile/${profileAddress}`)
                profileData = res.data
            } catch { /* profile may not exist yet */ }
            return { user, ...profileData }
        },
        { revalidateOnFocus: false }
    )
    return { profile, reloadProfile: mutate }
}
