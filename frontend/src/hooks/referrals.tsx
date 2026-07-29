import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type Referee = {
    address: string
    username?: string
    avatar?: string
    volumeUsd: number
    /** Buys minus sells, in USD — progress toward the activation floor. */
    netBoughtUsd: number
    /** Cleared the floor, so this referral actually earns and ranks. */
    active: boolean
}

export type ReferralSummary = {
    address: string
    referralCode?: string | null
    /** Active referrals only. */
    referralCount: number
    pendingReferralCount: number
    /** Net USD a referee must buy before their referral counts. */
    minRefereeUsd: number
    refereeVolumeUsd: number
    pointsFromReferrals: number
    referees: Referee[]
}

export type RefLeaderEntry = {
    rank: number
    address: string
    username?: string
    avatar?: string
    referralCount: number
    refereeVolumeUsd: number
}

export function useReferralSummary(address?: string) {
    const { data, mutate } = useSWR<ReferralSummary>(
        address ? ['/referrals', address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/referrals/${address}`)
            return data
        },
        { refreshInterval: 20000, keepPreviousData: true }
    )
    return { summary: data, reload: mutate }
}

export function useReferralLeaderboard(limit = 100) {
    const { data } = useSWR<RefLeaderEntry[]>(
        ['/referrals/leaderboard', limit],
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/referrals/leaderboard`, { params: { limit } })
            return Array.isArray(data) ? data : []
        },
        { refreshInterval: 30000, keepPreviousData: true }
    )
    return { entries: data ?? [] }
}
