import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type WalletStats = {
    address: string
    username?: string
    avatar?: string
    volumeUsd: number
    realizedPnlUsd: number
    unrealizedPnlUsd: number
    totalPnlUsd: number
    roiPct: number
    winRate: number
    tokensTraded: number
    tradeCount: number
    holdingValueUsd: number
}

export function useWallet(address?: string) {
    const { data } = useSWR<WalletStats>(
        address ? ['/wallet', address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/wallet/${address}`)
            return data
        },
        { refreshInterval: 20000, keepPreviousData: true }
    )
    return { wallet: data }
}
