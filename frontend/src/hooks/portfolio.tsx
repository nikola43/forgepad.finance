import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type Position = {
    tokenAddress: string
    name: string
    symbol: string
    image?: string
    network: string
    balance: number
    currentPriceUsd: number
    valueUsd: number
    costUsd: number
    avgBuyPriceUsd: number
    unrealizedPnlUsd: number
    unrealizedPnlPct: number
    realizedPnlUsd: number
}

export type Portfolio = {
    address: string
    totalValueUsd: number
    totalCostUsd: number
    unrealizedPnlUsd: number
    realizedPnlUsd: number
    totalPnlUsd: number
    roiPct: number
    positions: Position[]
}

export function usePortfolio(address?: string) {
    const { data, mutate } = useSWR<Portfolio>(
        address ? ['/portfolio', address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/portfolio/${address}`)
            return data
        },
        { refreshInterval: 15000, keepPreviousData: true }
    )
    return { portfolio: data, reload: mutate }
}
