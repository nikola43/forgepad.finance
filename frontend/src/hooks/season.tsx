import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type SeasonEntry = {
    rank: number
    address: string
    username?: string | null
    avatar?: string | null
    points: number
}

export type Season = {
    name: string
    startsAt: number
    endsAt: number
    prizePotEth: number
    leaderboard: SeasonEntry[]
}

// The current season window, prize pot and top-50 leaderboard. Points combine
// net trading volume and points-ledger grants earned inside the season window.
export function useSeason() {
    const { data, mutate, error, isLoading } = useSWR<Season>(
        '/season',
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/season`)
            return data
        },
        { refreshInterval: 15000, keepPreviousData: true }
    )

    return { season: data, reload: mutate, error, isLoading }
}
