'use client'

import { useEffect, useState } from "react"
import axios from "axios"
import { API_ENDPOINT } from "@/config"
import { Avatar, Box, CircularProgress, Typography } from "@mui/material"
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useRouter } from "next/navigation"

type Entry = {
    rank: number
    address: string
    username?: string
    avatar?: string
    volumeUsd: number
    trades: number
    points: number
    rewardEth: number
}

const cols = '48px 1fr 120px 110px 110px'

export default function Leaderboard() {
    const [rows, setRows] = useState<Entry[] | null>(null)
    const router = useRouter()

    useEffect(() => {
        let active = true
        axios
            .get(`${API_ENDPOINT}/users/leaderboard`, { params: { limit: 100 } })
            .then(({ data }) => { if (active) setRows(Array.isArray(data) ? data : []) })
            .catch(() => { if (active) setRows([]) })
        return () => { active = false }
    }, [])

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">
                    🏆 Leaderboard
                </Typography>
                <Typography fontSize={13} color="#94A3B8">
                    10 points per $1 bought, −4 per $1 sold. Each point is worth 0.000006 ETH in rewards.
                </Typography>
            </Box>

            {/* Rewards banner */}
            <Box
                sx={{
                    position: 'relative',
                    overflow: 'hidden',
                    borderRadius: '16px',
                    p: { xs: 2.5, sm: 3 },
                    mb: 3,
                    border: '1px solid rgba(211,255,36,0.25)',
                    background:
                        'linear-gradient(135deg, rgba(211,255,36,0.12) 0%, rgba(211,255,36,0.03) 45%, rgba(139,92,246,0.06) 100%)',
                }}
            >
                <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                    <Box sx={{ fontSize: 34, lineHeight: 1, flexShrink: 0 }}>💸</Box>
                    <Box>
                        <Typography fontSize={{ xs: 17, sm: 19 }} fontWeight={800} color="#fff" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.01em">
                            Trade. Earn points. Get paid every week.
                        </Typography>
                        <Typography fontSize={13.5} color="rgba(255,255,255,0.75)" mt={0.75} lineHeight={1.6}>
                            Every buy and sell carries a flat <b style={{ color: '#D3FF24' }}>1% fee</b> — and half of it flows
                            straight back to traders. You earn <b style={{ color: '#D3FF24' }}>10 points per $1 bought</b> and
                            {' '}<b style={{ color: '#D3FF24' }}>−4 per $1 sold</b>, so climbing the board rewards real conviction.
                            Each week we pool <b style={{ color: '#D3FF24' }}>50% of all platform fees</b> and pay it out in{' '}
                            <b style={{ color: '#D3FF24' }}>ETH</b> to everyone here, split by your share of points. Trade more,
                            rank higher, and claim a bigger weekly cut.
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
                            {['+10 pts / $1 buy', '−4 pts / $1 sell', '1% flat fee', '50% shared weekly', 'Paid in ETH'].map((chip) => (
                                <Box
                                    key={chip}
                                    sx={{
                                        fontSize: 11.5,
                                        fontWeight: 600,
                                        color: '#D3FF24',
                                        border: '1px solid rgba(211,255,36,0.3)',
                                        background: 'rgba(211,255,36,0.06)',
                                        borderRadius: '100px',
                                        px: 1.25,
                                        py: 0.4,
                                    }}
                                >
                                    {chip}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Box>
            </Box>

            {rows === null ? (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
            ) : rows.length === 0 ? (
                <Typography color="#64748B" py={6} textAlign="center">No trading activity yet.</Typography>
            ) : (
                <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', overflow: 'hidden' }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: cols, gap: 1, px: 2, py: 1.5, background: 'rgba(255,255,255,0.03)', fontSize: 12, color: '#64748B', fontWeight: 600 }}>
                        <Box>#</Box>
                        <Box>Trader</Box>
                        <Box textAlign="right">Volume</Box>
                        <Box textAlign="right">Points</Box>
                        <Box textAlign="right">Reward</Box>
                    </Box>
                    {rows.map((r) => (
                        <Box
                            key={r.address}
                            onClick={() => router.push(`/profile?address=${r.address}`)}
                            sx={{
                                display: 'grid', gridTemplateColumns: cols, gap: 1, px: 2, py: 1.5, alignItems: 'center',
                                borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
                                '&:hover': { background: 'rgba(255,255,255,0.03)' },
                            }}
                        >
                            <Box sx={{ fontWeight: 700, color: r.rank <= 3 ? '#D3FF24' : '#94A3B8' }}>{r.rank}</Box>
                            <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                                <Avatar src={r.avatar || undefined} sx={{ width: 28, height: 28 }} />
                                <Typography color="white" fontSize={14} noWrap>
                                    {r.username || `${r.address.slice(0, 6)}...${r.address.slice(-4)}`}
                                </Typography>
                            </Box>
                            <Typography textAlign="right" color="white" fontSize={14}>${priceFormatter(r.volumeUsd, 2)}</Typography>
                            <Typography textAlign="right" color="#e4ff66" fontSize={14} fontWeight={600}>{priceFormatter(r.points, 0)}</Typography>
                            <Typography textAlign="right" color="#10B981" fontSize={14} fontWeight={600}>{priceFormatter(r.rewardEth, 6)} ETH</Typography>
                        </Box>
                    ))}
                </Box>
            )}
        </PageBox>
    )
}
