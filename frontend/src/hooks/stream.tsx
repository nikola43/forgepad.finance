import useSWR from "swr"
import axios from "axios"
import { API_ENDPOINT } from "@/config"

export type StreamStatus = {
    tokenAddress: string
    isLive: boolean
    viewers: number
    startedAt?: string
}

export type StreamToken = {
    token: string
    url: string
    room: string
    identity: string
    isPublisher: boolean
    viewers: number
}

// Live status for the LIVE badge + viewer count. Polls while mounted.
export function useStreamStatus(tokenAddress?: string) {
    const { data, mutate } = useSWR<StreamStatus>(
        tokenAddress ? ['/stream', tokenAddress] : null,
        async () => (await axios.get(`${API_ENDPOINT}/stream/${tokenAddress}`)).data,
        { refreshInterval: 10000, keepPreviousData: true }
    )
    return { status: data, reload: mutate }
}

// Viewer: request a subscribe-only LiveKit token and record a heartbeat.
export async function joinStream(tokenAddress: string, address?: string): Promise<StreamToken> {
    const { data } = await axios.get(`${API_ENDPOINT}/stream/${tokenAddress}/join`, { params: { address } })
    return data
}

export async function heartbeatStream(tokenAddress: string, identity: string): Promise<number> {
    const { data } = await axios.post(`${API_ENDPOINT}/stream/${tokenAddress}/heartbeat`, { identity })
    return data.viewers ?? 0
}

// Creator: go live / end (signature is produced in the component).
export async function startStreamRequest(tokenAddress: string, address: string, message: string, signature: string): Promise<StreamToken> {
    const { data } = await axios.post(`${API_ENDPOINT}/stream/start`, { tokenAddress, address, message, signature })
    return data
}

export async function stopStreamRequest(tokenAddress: string, address: string, message: string, signature: string): Promise<StreamStatus> {
    const { data } = await axios.post(`${API_ENDPOINT}/stream/stop`, { tokenAddress, address, message, signature })
    return data
}
