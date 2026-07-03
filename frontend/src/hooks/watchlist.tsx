import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type WatchToken = {
    tokenAddress: string
    name: string
    symbol: string
    image?: string
    network: string
    marketcap: number
    price: number
}

export function useWatchlist(address?: string) {
    const { data, mutate } = useSWR<WatchToken[]>(
        address ? ['/watchlist', address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/watchlist/${address}`)
            return Array.isArray(data) ? data : []
        },
        { refreshInterval: 20000, keepPreviousData: true }
    )
    const list = data ?? []
    const isWatched = (tokenAddress?: string) =>
        !!tokenAddress && list.some((t) => t.tokenAddress.toLowerCase() === tokenAddress.toLowerCase())
    const toggle = async (tokenAddress: string, network: string) => {
        if (!address) return
        await axios.post(`${API_ENDPOINT}/watchlist/toggle`, { userAddress: address, tokenAddress, network })
        await mutate()
    }
    return { watchlist: list, isWatched, toggle, reload: mutate }
}
