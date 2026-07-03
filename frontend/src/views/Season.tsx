'use client'

import { useEffect, useState } from "react"
import { Box, CircularProgress, Typography } from "@mui/material"
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useSeason, type SeasonEntry } from "@/hooks/season"

function shortAddress(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

type Countdown = { days: number; hours: number; minutes: number; seconds: number; ended: boolean }

function computeCountdown(endsAt: number): Countdown {
    const now = Math.floor(Date.now() / 1000)
    let diff = endsAt - now
    if (diff <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, ended: true }
    }
    const days = Math.floor(diff / 86400); diff -= days * 86400
    const hours = Math.floor(diff / 3600); diff -= hours * 3600
    const minutes = Math.floor(diff / 60); diff -= minutes * 60
    const seconds = diff
    return { days, hours, minutes, seconds, ended: false }
}

function CountdownBlock({ value, label }: { value: number; label: string }) {
    return (
        <Box sx={{ textAlign: 'center', minWidth: 56 }}>
            <Typography fontSize={30} fontWeight={800} color="#fff" fontFamily="'Space Grotesk', sans-serif" lineHeight={1}>
                {String(value).padStart(2, '0')}
            </Typography>
            <Typography fontSize={10} color="#94A3B8" textTransform="uppercase" letterSpacing="0.08em" mt={0.5}>{label}</Typography>
        </Box>
    )
}

export default function Season() {
    const { season } = useSeason()
    const [countdown, setCountdown] = useState<Countdown | null>(null)

    useEffect(() => {
        if (typeof window === 'undefined' || !season) return
        setCountdown(computeCountdown(season.endsAt))
        const id = window.setInterval(() => {
            setCountdown(computeCountdown(season.endsAt))
        }, 1000)
        return () => window.clearInterval(id)
    }, [season])

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            {!season ? (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress sx={{ color: '#D3FF24' }} /></Box>
            ) : (
                <>
                    {/* Header + prize pot */}
                    <Box sx={{ mb: 3, p: 3, borderRadius: '18px', border: '1px solid rgba(211,255,36,0.25)', background: 'linear-gradient(135deg, rgba(211,255,36,0.10), rgba(211,255,36,0.02))' }}>
                        <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
                            <Box>
                                <Typography fontSize={12} color="#e4ff66" textTransform="uppercase" letterSpacing="0.1em" fontWeight={700}>🏆 Current Season</Typography>
                                <Typography fontSize={30} fontWeight={800} color="#fff" fontFamily="'Space Grotesk', sans-serif">{season.name}</Typography>
                            </Box>
                            <Box textAlign="right">
                                <Typography fontSize={11} color="#94A3B8" textTransform="uppercase" letterSpacing="0.08em">Prize Pot</Typography>
                                <Typography fontSize={28} fontWeight={800} color="#e4ff66" fontFamily="'Space Grotesk', sans-serif">{priceFormatter(season.prizePotEth, 4)} ETH</Typography>
                            </Box>
                        </Box>

                        {/* Countdown */}
                        <Box mt={2.5}>
                            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase" letterSpacing="0.08em" mb={1}>
                                {countdown?.ended ? 'Season ended' : 'Ends in'}
                            </Typography>
                            {countdown && !countdown.ended ? (
                                <Box display="flex" gap={1.5} alignItems="center">
                                    <CountdownBlock value={countdown.days} label="Days" />
                                    <CountdownBlock value={countdown.hours} label="Hours" />
                                    <CountdownBlock value={countdown.minutes} label="Mins" />
                                    <CountdownBlock value={countdown.seconds} label="Secs" />
                                </Box>
                            ) : (
                                <Typography fontSize={22} fontWeight={700} color="#fff">🏁 Finished</Typography>
                            )}
                        </Box>
                    </Box>

                    {/* Leaderboard */}
                    <Typography color="white" fontSize={18} fontWeight={700} mb={1.5}>Leaderboard</Typography>
                    <Box sx={{ overflowX: 'auto' }}>
                        <Box sx={{ minWidth: 420 }}>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '60px 1fr 140px', px: 2, py: 1, color: '#64748B', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                <Box>Rank</Box>
                                <Box>Trader</Box>
                                <Box textAlign="right">Points</Box>
                            </Box>
                            {season.leaderboard.length === 0 ? (
                                <Typography color="#64748B" py={4} textAlign="center">No competitors yet — be the first to climb the board.</Typography>
                            ) : (
                                season.leaderboard.map((e: SeasonEntry) => (
                                    <Box
                                        key={e.address}
                                        sx={{
                                            display: 'grid', gridTemplateColumns: '60px 1fr 140px', alignItems: 'center',
                                            px: 2, py: 1.25, borderRadius: '10px',
                                            border: '1px solid rgba(255,255,255,0.05)', mb: 0.75,
                                            background: e.rank <= 3 ? 'rgba(211,255,36,0.05)' : 'rgba(255,255,255,0.02)',
                                        }}
                                    >
                                        <Typography color={e.rank <= 3 ? '#e4ff66' : '#94A3B8'} fontWeight={700} fontSize={15}>#{e.rank}</Typography>
                                        <Typography color="white" fontSize={14} fontWeight={600} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {e.username || shortAddress(e.address)}
                                        </Typography>
                                        <Typography color="#e4ff66" fontSize={14} fontWeight={700} textAlign="right">{priceFormatter(e.points, 2)}</Typography>
                                    </Box>
                                ))
                            )}
                        </Box>
                    </Box>
                </>
            )}
        </PageBox>
    )
}
