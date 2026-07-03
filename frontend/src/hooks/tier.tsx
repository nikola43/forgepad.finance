import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type Tier = {
    address: string
    volumeUsd: number
    tier: string
    nextTier: string | null
    nextThresholdUsd: number | null
    progressPct: number
}

// Lifetime trade-volume tier for an address (Bronze/Silver/Gold/Diamond).
export function useTier(address?: string) {
    const { data, mutate, error, isLoading } = useSWR<Tier>(
        address ? ['/tier', address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/tier/${address}`)
            return data
        },
        { refreshInterval: 30000, keepPreviousData: true }
    )

    return { tier: data, reload: mutate, error, isLoading }
}
