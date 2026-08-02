import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

// ---------------------------------------------------------------------------
// Payout receipts.
//
// The platform's distinguishing claim is that it pays traders back 0.3% of every
// trade, on-chain, every week. These hooks fetch the evidence for it: what each
// settled round paid, to whom, and what a given wallet has actually received.
//
// Every wei amount crosses the wire as a decimal STRING and is converted here
// with BigInt, never Number — 1e18-scale integers do not survive a float. Only
// the final human-readable value is a float, and only for formatting.
// ---------------------------------------------------------------------------

export type RoundReceipt = {
    roundId: number
    timeStart: number
    timeEnd: number
    txHash: string | null
    potWei: string | null
    distributedWei: string | null
    winnerAddress: string | null
    winnerAmountWei: string | null
    holderCount: number | null
    /** The VRF word that picked the lottery winner — published so it can be checked. */
    vrfRandom: string | null
    distributedAt: number | null
}

export type PayoutLine = {
    roundId: number
    address: string
    /** The recipient's fraction of 2^32, exactly as committed on-chain. */
    share: number
    amountWei: string
    username: string | null
    avatar: string | null
}

export type RoundDetail = RoundReceipt & { payouts: PayoutLine[] }

export type PayoutStats = {
    totalPaidWei: string
    roundsSettled: number
    uniqueRecipients: number
    largestPayoutWei: string
    lastRoundAt: number | null
}

export type AddressPayouts = {
    address: string
    totalWei: string
    roundsPaid: number
    payouts: PayoutLine[]
}

/**
 * Wei string → BNB as a number, for display only.
 *
 * Goes through BigInt so the integer part is never rounded by a float, then
 * splits off 18 decimals by hand. Returns 0 for null/blank/unparseable rather
 * than NaN, so a missing figure renders as "0" and not "NaN BNB".
 */
export function weiToBnb(wei?: string | null): number {
    if (!wei) return 0
    try {
        const v = BigInt(wei)
        const whole = v / 1000000000000000000n
        const frac = v % 1000000000000000000n
        return Number(whole) + Number(frac) / 1e18
    } catch {
        return 0
    }
}

/** Lifetime payback totals — the headline number. Public, no wallet needed. */
export function usePayoutStats() {
    const { data, error, isLoading } = useSWR<PayoutStats>(
        '/distributor/stats',
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/distributor/stats`)
            return data
        },
        // Rounds settle weekly; a minute of staleness costs nothing.
        { refreshInterval: 60000, keepPreviousData: true }
    )
    return { stats: data, error, isLoading }
}

export type Pot = {
    /** Live Distributor balance in BNB. Null when the RPC read failed. */
    potBnb: number | null
    /** Share paid pro-rata; the remainder goes to the random winner. */
    distributeBps: number
    /** Unix seconds of the next round close, read off the contract's schedule. */
    roundEnd: number
    /** Points across the whole payout set — the denominator of every share. */
    totalPoints: number | null
    /** Points credited per $1 of volume. Buys and sells score alike. */
    pointsPerUsd: number
}

/**
 * What a trade of `usdNotional` earns this round: the points it banks, and what
 * that slice of the pot is currently worth.
 *
 * The BNB figure adds the new points to the denominator as well as the
 * numerator, so it is what the trade would be worth if nothing else changed —
 * never an over-quote. Returns null components when the pot or the denominator
 * is unknown, and callers then show the points alone rather than a made-up
 * number. Nothing here is a promise: the round is still open and everyone else
 * is still trading into the same pot.
 */
export function estimateTradeEarn(usdNotional: number, pot?: Pot) {
    if (!Number.isFinite(usdNotional) || usdNotional <= 0) return null
    const points = usdNotional * (pot?.pointsPerUsd ?? 1)
    const potBnb = pot?.potBnb
    const total = pot?.totalPoints
    if (potBnb == null || total == null || potBnb <= 0) return { points, bnb: null }
    const share = points / (total + points)
    return { points, bnb: potBnb * ((pot?.distributeBps ?? 9000) / 10000) * share }
}

/** The pot currently building, and when it pays out. */
export function usePot() {
    const { data, error, isLoading } = useSWR<Pot>(
        '/distributor/pot',
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/distributor/pot`, { timeout: 8000 })
            return data
        },
        // Backend caches the on-chain read for 60s, so polling here is free.
        { refreshInterval: 30000, keepPreviousData: true }
    )
    return { pot: data, error, isLoading }
}

/** The public ledger of settled rounds, newest first. */
export function usePayoutRounds(limit = 25) {
    const { data, error, isLoading } = useSWR<RoundReceipt[]>(
        ['/distributor/rounds', limit],
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/distributor/rounds`, { params: { limit } })
            return Array.isArray(data) ? data : []
        },
        { refreshInterval: 60000, keepPreviousData: true }
    )
    return { rounds: data, error, isLoading }
}

/** One round's full receipt, including every recipient. */
export function usePayoutRound(roundId?: number | null) {
    const { data, error, isLoading } = useSWR<RoundDetail>(
        roundId ? ['/distributor/round', roundId] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/distributor/rounds/${roundId}`)
            return data
        },
        { keepPreviousData: true }
    )
    return { round: data, error, isLoading }
}

/** What this wallet has actually been paid, across every settled round. */
export function useAddressPayouts(address?: string) {
    const { data, error, isLoading } = useSWR<AddressPayouts>(
        address ? ['/distributor/payouts', address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/distributor/payouts/${address}`)
            return data
        },
        { refreshInterval: 60000, keepPreviousData: true }
    )
    return { payouts: data, error, isLoading }
}

/**
 * BNB the contract owes this wallet from payout pushes that failed (contract
 * wallets, reverting receivers). It is already theirs and sits in the contract
 * until `claim()` is called, so it is worth surfacing loudly.
 *
 * `claimableWei` is null when the RPC is unreachable — callers must hide the
 * banner in that case rather than assert the user is owed nothing.
 */
export function useClaimable(address?: string) {
    const { data, error, isLoading, mutate } = useSWR<{
        address: string
        claimableWei: string | null
        distributorAddress: string | null
    }>(
        address ? ['/distributor/claimable', address] : null,
        async () => {
            const { data } = await axios.get(`${API_ENDPOINT}/distributor/claimable/${address}`)
            return data
        },
        { refreshInterval: 60000, keepPreviousData: true }
    )
    return {
        claimableWei: data?.claimableWei ?? null,
        distributorAddress: data?.distributorAddress ?? null,
        reload: mutate,
        error,
        isLoading,
    }
}

/**
 * BNB/USD spot, for turning payout figures into dollars.
 *
 * Coinbase primary, CoinGecko fallback — both public and CORS-enabled, no key.
 * Returns undefined if both fail, and every caller then hides the USD line
 * rather than showing a wrong one.
 */
export function useBnbUsd() {
    const { data } = useSWR<number | undefined>(
        '/bnb-usd',
        async () => {
            try {
                const { data } = await axios.get('https://api.coinbase.com/v2/prices/BNB-USD/spot', { timeout: 8000 })
                const p = Number(data?.data?.amount)
                if (p > 0) return p
            } catch { /* fall through to the secondary source */ }
            try {
                const { data } = await axios.get(
                    'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd',
                    { timeout: 8000 },
                )
                const p = Number(data?.binancecoin?.usd)
                if (p > 0) return p
            } catch { /* leave undefined; USD lines stay hidden */ }
            return undefined
        },
        { refreshInterval: 60000, keepPreviousData: true }
    )
    return data
}
