import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type PaperPosition = {
    tokenAddress: string
    network: string
    name: string
    symbol: string
    image?: string
    tokenAmount: number
    investedEth: number
    currentValueEth: number
    unrealizedPnlEth: number
    realizedPnlEth: number
    roiPct: number
}

export type PaperPortfolio = {
    address: string
    ethBalance: number
    startingBalance: number
    ethPriceUsd: number
    holdingsValueEth: number
    totalValueEth: number
    totalPnlEth: number
    totalPnlPct: number
    positions: PaperPosition[]
}

// Risk-free simulator: virtual BNB balance, trades priced on the live bonding
// curve server-side. All mutations return the fresh portfolio so we update the
// SWR cache in one round-trip.
export function usePaper(address?: string) {
    const { data, mutate, isLoading } = useSWR<PaperPortfolio>(
        address ? ['/paper', address] : null,
        async () => (await axios.get(`${API_ENDPOINT}/paper/${address}`)).data,
        { refreshInterval: 15000, keepPreviousData: true }
    )

    const buy = async (tokenAddress: string, amountEth: number) => {
        const { data } = await axios.post(`${API_ENDPOINT}/paper/buy`, { address, tokenAddress, amountEth })
        await mutate(data, { revalidate: false })
        return data as PaperPortfolio
    }
    const sell = async (tokenAddress: string, percent = 1) => {
        const { data } = await axios.post(`${API_ENDPOINT}/paper/sell`, { address, tokenAddress, percent })
        await mutate(data, { revalidate: false })
        return data as PaperPortfolio
    }
    const reset = async () => {
        const { data } = await axios.post(`${API_ENDPOINT}/paper/reset`, { address })
        await mutate(data, { revalidate: false })
        return data as PaperPortfolio
    }

    return { paper: data, isLoading, reload: mutate, buy, sell, reset }
}
