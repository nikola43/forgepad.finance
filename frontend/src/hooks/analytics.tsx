import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type TokenAnalytics = {
    tokenAddress: string
    network: string
    holderCount: number
    top10Pct: number
    creatorPct: number
    buys: number
    sells: number
    volumeUsd: number
    graduationPct: number
    launched: boolean
    bundleBuyers: number
    bundleFlag: boolean
}

export type TopTrader = {
    address: string
    username?: string
    avatar?: string
    realizedPnlUsd: number
    unrealizedPnlUsd: number
    totalPnlUsd: number
    volumeUsd: number
    isCreator: boolean
}

export function useTokenAnalytics(network?: string, address?: string) {
    const { data } = useSWR<TokenAnalytics>(
        network && address ? ['/analytics/token', network, address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/analytics/token/${network}/${address}`)
            return data
        },
        { refreshInterval: 20000, keepPreviousData: true }
    )
    return { analytics: data }
}

export function useTopTraders(network?: string, address?: string) {
    const { data } = useSWR<TopTrader[]>(
        network && address ? ['/analytics/top-traders', network, address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/analytics/top-traders/${network}/${address}`)
            return Array.isArray(data) ? data : []
        },
        { refreshInterval: 20000, keepPreviousData: true }
    )
    return { traders: data ?? [] }
}
