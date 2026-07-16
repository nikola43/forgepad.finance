'use client'

import { Avatar, Box, CircularProgress, Typography } from "@mui/material"
import { useRouter } from "next/navigation"
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium'
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
                border: '1px solid rgba(234,230,218,0.06)',
                background: 'rgba(234,230,218,0.02)',
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                cursor: 'pointer',
                transition: 'all 0.15s',
                '&:hover': { border: '1px solid rgba(191,209,67,0.35)', background: 'rgba(191,209,67,0.04)' },
            }}
        >
            <Avatar src={r.image ?? undefined} sx={{ width: 40, height: 40 }}>{r.symbol?.[0] ?? '?'}</Avatar>
            <Box flexGrow={1} minWidth={0}>
                <Typography color="var(--bone)" fontSize={15} fontWeight={600} noWrap>{r.name}</Typography>
                <Typography color="var(--muted)" fontSize={12} noWrap fontFamily="var(--font-data)">${r.symbol}</Typography>
            </Box>
            <Box textAlign="right" flexShrink={0}>
                <Typography color="var(--tangerine)" fontSize={14} fontWeight={700} fontFamily="var(--font-data)" display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
                    <WorkspacePremiumIcon sx={{ fontSize: 15 }} /> {formatDuration(r.durationSecs)}
                </Typography>
                <Typography color="var(--text-muted)" fontSize={11} textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">
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
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <WorkspacePremiumIcon sx={{ fontSize: 26 }} /> Hall of Champions
                </Typography>
                <Typography fontSize={13} color="var(--muted)">
                    Every token that has held the King of the Hill throne, most recent first.
                </Typography>
            </Box>

            {!reigns ? (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress sx={{ color: 'var(--citron)' }} /></Box>
            ) : reigns.length === 0 ? (
                <Typography color="var(--text-muted)" py={6} textAlign="center">No kings crowned yet.</Typography>
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
