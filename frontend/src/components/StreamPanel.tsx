'use client'

import { useCallback, useEffect, useState } from "react"
import { Box, Button, CircularProgress, Typography } from "@mui/material"
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from "@livekit/components-react"
import "@livekit/components-styles"
import { BrowserProvider } from "ethers"
import { useAppKitAccount, useAppKitProvider, type Provider as EVMProvider } from "@reown/appkit/react"
import toast from "react-hot-toast"
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import {
    useStreamStatus,
    joinStream,
    heartbeatStream,
    startStreamRequest,
    stopStreamRequest,
    type StreamToken,
} from "@/hooks/stream"

const ACCENT = "#22C55E"

// Native in-app broadcast (Tier C). Creators publish cam/mic/screen from the
// browser via LiveKit; everyone else auto-subscribes. All LiveKit wiring is
// contained here so the token page only renders <StreamPanel/>.
export default function StreamPanel({ tokenAddress, creatorAddress }: { tokenAddress?: string; creatorAddress?: string }) {
    const { address } = useAppKitAccount()
    const { walletProvider: evmProvider } = useAppKitProvider<EVMProvider>("eip155")
    const { status, reload } = useStreamStatus(tokenAddress)
    const [session, setSession] = useState<StreamToken | null>(null)
    const [busy, setBusy] = useState(false)

    const isCreator = !!address && !!creatorAddress && address.toLowerCase() === creatorAddress.toLowerCase()
    const isLive = status?.isLive ?? false

    // Keep viewers "fresh" so the live count stays accurate.
    useEffect(() => {
        if (!session || session.isPublisher || !tokenAddress) return
        const iv = setInterval(() => { heartbeatStream(tokenAddress, session.identity).catch(() => {}) }, 15000)
        return () => clearInterval(iv)
    }, [session, tokenAddress])

    const sign = useCallback(async (message: string) => {
        if (!evmProvider) throw new Error("Connect your wallet first")
        const provider = new BrowserProvider(evmProvider)
        const signer = await provider.getSigner()
        return signer.signMessage(message)
    }, [evmProvider])

    const goLive = useCallback(async () => {
        if (!tokenAddress || !address) { toast.error("Connect your wallet first"); return }
        setBusy(true)
        try {
            const message = `Go live on ${tokenAddress}\n${Date.now()}`
            const signature = await sign(message)
            const s = await startStreamRequest(tokenAddress, address, message, signature)
            setSession(s)
            reload()
        } catch (e: any) {
            toast.error(e?.response?.data?.error || e?.message || "Failed to go live")
        } finally { setBusy(false) }
    }, [tokenAddress, address, sign, reload])

    const endLive = useCallback(async () => {
        if (!tokenAddress || !address) return
        setBusy(true)
        try {
            const message = `End stream on ${tokenAddress}\n${Date.now()}`
            const signature = await sign(message)
            await stopStreamRequest(tokenAddress, address, message, signature)
            setSession(null)
            reload()
        } catch (e: any) {
            toast.error(e?.response?.data?.error || e?.message || "Failed to end stream")
        } finally { setBusy(false) }
    }, [tokenAddress, address, sign, reload])

    const watch = useCallback(async () => {
        if (!tokenAddress) return
        setBusy(true)
        try {
            const s = await joinStream(tokenAddress, address || undefined)
            setSession(s)
        } catch (e: any) {
            toast.error(e?.response?.data?.error || e?.message || "Failed to join stream")
        } finally { setBusy(false) }
    }, [tokenAddress, address])

    // Connected — render the LiveKit room.
    if (session) {
        return (
            <Box sx={{ my: 2 }}>
                <Box data-lk-theme="default" sx={{ height: 480, borderRadius: "14px", overflow: "hidden", border: "1px solid var(--border)" }}>
                    <LiveKitRoom
                        token={session.token}
                        serverUrl={session.url}
                        connect
                        video={session.isPublisher}
                        audio={session.isPublisher}
                        onError={(e) => toast.error(e?.message || "Stream connection error")}
                        onDisconnected={() => setSession(null)}
                        style={{ height: "100%" }}
                    >
                        <VideoConference />
                        <RoomAudioRenderer />
                    </LiveKitRoom>
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mt={1.5}>
                    <Typography fontSize={12} color="var(--muted)">
                        {session.isPublisher ? "You are broadcasting live" : "Watching live"}
                    </Typography>
                    {session.isPublisher ? (
                        <Button onClick={endLive} disabled={busy} sx={{ textTransform: "none", color: "#D64545", border: "1px solid rgba(214,69,69,0.4)", borderRadius: "10px", px: 2 }}>
                            {busy ? <CircularProgress size={16} /> : "End Stream"}
                        </Button>
                    ) : (
                        <Button onClick={() => setSession(null)} sx={{ textTransform: "none", color: "var(--muted)", borderRadius: "10px", px: 2 }}>
                            Leave
                        </Button>
                    )}
                </Box>
            </Box>
        )
    }

    // Idle — show the right call-to-action.
    return (
        <Box sx={{ my: 2, p: 3, borderRadius: "16px", border: "1px solid var(--border)", background: "rgba(234,230,218,0.03)", display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, textAlign: "center" }}>
            {isLive && (
                <Box display="flex" alignItems="center" gap={1}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", background: "#D64545" }} />
                    <Typography fontSize={13} color="var(--text-primary)" fontWeight={700} fontFamily="var(--font-data)">LIVE · {status?.viewers ?? 0} watching</Typography>
                </Box>
            )}
            {isCreator ? (
                isLive ? (
                    <Box display="flex" gap={1.5}>
                        <Button onClick={goLive} disabled={busy} sx={{ textTransform: "none", background: ACCENT, color: "#04120A", fontWeight: 700, borderRadius: "12px", px: 3, "&:hover": { background: "#16A34A" } }}>
                            {busy ? <CircularProgress size={18} /> : "Resume broadcast"}
                        </Button>
                        <Button onClick={endLive} disabled={busy} sx={{ textTransform: "none", color: "#D64545", border: "1px solid rgba(214,69,69,0.4)", borderRadius: "12px", px: 3 }}>
                            End Stream
                        </Button>
                    </Box>
                ) : (
                    <>
                        <Typography fontSize={14} color="var(--muted)">Broadcast to your holders — camera, mic, or screen-share, live on your coin page.</Typography>
                        <Button onClick={goLive} disabled={busy} sx={{ textTransform: "none", background: ACCENT, color: "#04120A", fontWeight: 700, borderRadius: "12px", px: 3, py: 1, "&:hover": { background: "#16A34A" } }}>
                            {busy ? <CircularProgress size={18} /> : <><FiberManualRecordIcon sx={{ fontSize: 12, mr: 0.75 }} />Go Live</>}
                        </Button>
                    </>
                )
            ) : isLive ? (
                <Button onClick={watch} disabled={busy} sx={{ textTransform: "none", background: ACCENT, color: "#04120A", fontWeight: 700, borderRadius: "12px", px: 3, py: 1, "&:hover": { background: "#16A34A" } }}>
                    {busy ? <CircularProgress size={18} /> : `Watch Live (${status?.viewers ?? 0} watching)`}
                </Button>
            ) : (
                <Typography fontSize={14} color="var(--text-muted)">No live stream right now. Check back later.</Typography>
            )}
        </Box>
    )
}
