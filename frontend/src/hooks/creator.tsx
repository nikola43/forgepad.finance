import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type CreatorToken = {
    tokenAddress: string
    name: string
    symbol: string
    image?: string
    network: string
    launched: boolean
    progressPct: number
    volumeUsd: number
    feesUsd: number
    buys: number
    sells: number
    holders: number
    uniqueTraders: number
}

export type CreatorDashboard = {
    address: string
    tokenCount: number
    graduatedCount: number
    totalVolumeUsd: number
    totalFeesUsd: number
    tokens: CreatorToken[]
}

export function useCreatorDashboard(address?: string) {
    const { data, mutate } = useSWR<CreatorDashboard>(
        address ? ['/creator', address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/creator/${address}`)
            return data
        },
        { refreshInterval: 20000, keepPreviousData: true }
    )
    return { dashboard: data, reload: mutate }
}
