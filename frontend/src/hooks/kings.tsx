import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type Reign = {
    tokenAddress: string
    name: string
    symbol: string
    image: string | null
    network: string
    startedAt: number
    endedAt: number | null
    durationSecs: number
}

// History of King-of-the-Hill reigns, most recent first (up to 100).
export function useKingsHistory() {
    const { data, mutate, error, isLoading } = useSWR<Reign[]>(
        '/kings/history',
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/kings/history`)
            return data
        },
        { refreshInterval: 30000, keepPreviousData: true }
    )

    return { reigns: data, reload: mutate, error, isLoading }
}
