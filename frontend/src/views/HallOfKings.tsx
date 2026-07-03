'use client'

import { Avatar, Box, CircularProgress, Typography } from "@mui/material"
import { useRouter } from "next/navigation"
import PageBox from "@/components/layout/pageBox"
import { useKingsHistory, type Reign } from "@/hooks/kings"

// Format a duration in seconds to a compact "Xh Ym" / "Ym Zs" string.
function formatDuration(secs: number) {
    const s = Math.max(0, Math.floor(secs))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
}

function ReignRow({ r, onClick }: { r: Reign; onClick: () => void }) {
    return (
        <Box
            onClick={onClick}
            sx={{
                p: 2,
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(255,255,255,0.02)',
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                cursor: 'pointer',
                transition: 'all 0.15s',
                '&:hover': { border: '1px solid rgba(211,255,36,0.35)', background: 'rgba(211,255,36,0.04)' },
            }}
        >
            <Avatar src={r.image ?? undefined} sx={{ width: 40, height: 40 }}>{r.symbol?.[0] ?? '?'}</Avatar>
            <Box flexGrow={1} minWidth={0}>
                <Typography color="white" fontSize={15} fontWeight={600} noWrap>{r.name}</Typography>
                <Typography color="#94A3B8" fontSize={12} noWrap>${r.symbol}</Typography>
            </Box>
            <Box textAlign="right" flexShrink={0}>
                <Typography color="#e4ff66" fontSize={14} fontWeight={700}>👑 {formatDuration(r.durationSecs)}</Typography>
                <Typography color="#64748B" fontSize={11} textTransform="uppercase" letterSpacing="0.05em">
                    {r.endedAt ? 'Reign' : 'Reigning now'}
                </Typography>
            </Box>
        </Box>
    )
}

export default function HallOfKings() {
    const router = useRouter()
    const { reigns } = useKingsHistory()

    const goToken = (r: Reign) => {
        router.push(`/token?network=${encodeURIComponent(r.network)}&address=${encodeURIComponent(r.tokenAddress)}`)
    }

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">👑 Hall of Kings</Typography>
                <Typography fontSize={13} color="#94A3B8">
                    Every token that has held the King of the Hill throne, most recent first.
                </Typography>
            </Box>

            {!reigns ? (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress sx={{ color: '#D3FF24' }} /></Box>
            ) : reigns.length === 0 ? (
                <Typography color="#64748B" py={6} textAlign="center">No kings crowned yet.</Typography>
            ) : (
                <Box sx={{ display: 'grid', gap: 1.5 }}>
                    {reigns.map((r, i) => (
                        <ReignRow key={`${r.tokenAddress}-${r.startedAt}-${i}`} r={r} onClick={() => goToken(r)} />
                    ))}
                </Box>
            )}
        </PageBox>
    )
}
