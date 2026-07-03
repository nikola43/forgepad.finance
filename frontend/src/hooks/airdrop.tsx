import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type Airdrop = {
    address: string
    yourPoints: number
    totalPoints: number
    rank: number
    totalUsers: number
    sharePct: number
}

// Indicative airdrop allocation for an address, derived from accrued points.
// Returns undefined until an address is connected.
export function useAirdrop(address?: string) {
    const { data, mutate, error, isLoading } = useSWR<Airdrop>(
        address ? ['/airdrop', address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/airdrop/${address}`)
            return data
        },
        { refreshInterval: 15000, keepPreviousData: true }
    )

    return { airdrop: data, reload: mutate, error, isLoading }
}
