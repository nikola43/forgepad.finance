import useSWR from "swr";
import { BrowserProvider, ethers } from "ethers";
import { type Provider as EVMProvider, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { API_ENDPOINT } from "@/config";
import axios from "axios";
import { useEffect, useRef } from "react";

const REF_STORAGE_KEY = 'fyuz_ref'
// Pre-rebrand key. Still read (and cleared) so a visitor who landed with a
// ?ref= before the Fyuz rename still gets attributed when they connect.
const LEGACY_REF_STORAGE_KEY = 'arrowpad_ref'

const readRefCode = () =>
    localStorage.getItem(REF_STORAGE_KEY) || localStorage.getItem(LEGACY_REF_STORAGE_KEY)

const clearRefCode = () => {
    localStorage.removeItem(REF_STORAGE_KEY)
    localStorage.removeItem(LEGACY_REF_STORAGE_KEY)
}

export function useUserInfo() {
    const { address } = useAppKitAccount()
    const { walletProvider } = useAppKitProvider<EVMProvider>("eip155")

    const { data: userInfo, mutate } = useSWR(
      address ? '/info/user' : undefined,
      async () => {
        if (!address) return { balance: 0 } as any
        try {
          const provider = walletProvider
            ? new ethers.BrowserProvider(walletProvider)
            : new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org")
          const balanceWei = await provider.getBalance(address)
          const balanceInEther = ethers.formatEther(balanceWei)
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
                return data.user
            } catch (err: any) {
                if (err?.response?.status === 404) return null
                throw err
            }
        },
        { revalidateOnFocus: false }
    )

    // Capture a ?ref=CODE from the landing URL and persist it, so it can be
    // attributed when the wallet connects and auto-registers.
    useEffect(() => {
        if (typeof window === 'undefined') return
        const ref = new URLSearchParams(window.location.search).get('ref')
        if (ref) localStorage.setItem(REF_STORAGE_KEY, ref)
    }, [])

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
                const msg = `Register on Fyuz\n${address}\n${Date.now()}`
                const signature = await signer.signMessage(msg)
                const refCode = (typeof window !== 'undefined' && readRefCode()) || undefined
                await axios.post(`${API_ENDPOINT}/users`, {
                    user: { username: '', bio: '', avatar: '' },
                    signature,
                    msg,
                    refCode,
                })
                clearRefCode()
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
                user = res.data.user
            } catch (err: any) {
                if (err?.response?.status !== 404) throw err
            }
            let profileData: any = { helds: [], replies: [], tokens: [], followers: 0, followees: [], followerCount: 0, followeeCount: 0, referrals: 0, points: null, tradingPoints: 0, tradingVolumeUsd: 0, rewardEth: 0 }
            try {
                const res = await axios.get(`${API_ENDPOINT}/users/profile/${profileAddress}`)
                const d = res.data
                // Fetch followings list separately (the profile endpoint only returns counts)
                let followeesList: any[] = []
                try {
                    const fRes = await axios.get(`${API_ENDPOINT}/users/followings/${profileAddress}`)
                    followeesList = fRes.data ?? []
                } catch { /* followings may not exist */ }
                // Map backend camelCase fields to frontend expected names
                profileData = {
                    helds: d.holdings ?? d.helds ?? [],
                    replies: d.chats ?? d.replies ?? [],
                    tokens: d.createdTokens ?? d.tokens ?? [],
                    followerCount: typeof d.followers === 'number' ? d.followers : (Array.isArray(d.followers) ? d.followers.length : 0),
                    followeeCount: typeof d.followees === 'number' ? d.followees : (Array.isArray(d.followees) ? d.followees.length : 0),
                    followers: Array.isArray(d.followers) ? d.followers : [],
                    followees: followeesList,
                    referrals: d.referralCount ?? d.referrals ?? 0,
                    points: d.points ?? null,
                    tradingPoints: d.tradingPoints ?? 0,
                    tradingVolumeUsd: d.tradingVolumeUsd ?? 0,
                    rewardEth: d.rewardEth ?? 0,
                }
            } catch { /* profile may not exist yet */ }
            return { user, ...profileData }
        },
        { revalidateOnFocus: false }
    )
    return { profile, reloadProfile: mutate }
}
