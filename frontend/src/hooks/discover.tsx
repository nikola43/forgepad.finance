import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type DiscoverToken = {
    tokenAddress: string
    name: string
    symbol: string
    image?: string
    network: string
    creatorAddress?: string
    marketcap: number
    priceUsd: number
    createdAt: number
    launched: boolean
    volume24h: number
    buys24h: number
    sells24h: number
    holders: number
    priceChange24h: number
    graduationPct: number
}

export type DiscoverParams = {
    tab?: string
    network?: string
    minMarketcap?: number
    minVolume?: number
    minHolders?: number
    maxAgeSecs?: number
    status?: string
    limit?: number
}

export function useDiscover(params: DiscoverParams) {
    const { data } = useSWR<DiscoverToken[]>(
        ['/discover', params],
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/discover`, { params })
            return Array.isArray(data) ? data : []
        },
        { refreshInterval: 10000, keepPreviousData: true }
    )
    return { tokens: data ?? [] }
}
