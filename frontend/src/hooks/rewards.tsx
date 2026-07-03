import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type Quest = {
    key: string
    title: string
    description: string
    kind: 'oneoff' | 'daily'
    target: number
    progress: number
    points: number
    completed: boolean
    claimed: boolean
}

export type Achievement = {
    key: string
    title: string
    description: string
    icon: string
    points: number
    earned: boolean
}

export type Rewards = {
    address: string
    currentStreak: number
    longestStreak: number
    bonusPoints: number
    quests: Quest[]
    achievements: Achievement[]
}

// Live rewards state for an address (quests, streak, achievements). Returns
// undefined until an address is connected or if the user has no on-chain history.
export function useRewards(address?: string) {
    const { data, mutate, error, isLoading } = useSWR<Rewards>(
        address ? ['/rewards', address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/rewards/${address}`)
            return data
        },
        { refreshInterval: 15000, keepPreviousData: true }
    )

    const claim = async (questKey: string) => {
        if (!address) return
        await axios.post(`${API_ENDPOINT}/rewards/${address}/claim/${questKey}`)
        await mutate()
    }

    return { rewards: data, reload: mutate, claim, error, isLoading }
}
