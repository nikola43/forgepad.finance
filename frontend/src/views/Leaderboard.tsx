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
                            <Box sx={{ fontWeight: 700, color: r.rank <= 3 ? '#d1ff1a' : '#94A3B8' }}>{r.rank}</Box>
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
