'use client'

import { useEffect, useState } from "react"
import { Box, CircularProgress, Typography } from "@mui/material"
import EventIcon from '@mui/icons-material/Event'
import FlagIcon from '@mui/icons-material/Flag'
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
            <Typography fontSize={30} fontWeight={800} color="var(--bone)" fontFamily="var(--font-data)" lineHeight={1}>
                {String(value).padStart(2, '0')}
            </Typography>
            <Typography fontSize={10} color="var(--muted)" textTransform="uppercase" letterSpacing="0.08em" mt={0.5} fontFamily="var(--font-data)">{label}</Typography>
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
                <Box display="flex" justifyContent="center" py={6}><CircularProgress sx={{ color: 'var(--citron)' }} /></Box>
            ) : (
                <>
                    {/* Header + prize pot */}
                    <Box sx={{ mb: 3, p: 3, borderRadius: '18px', border: '1px solid rgba(191,209,67,0.25)', background: 'rgba(191,209,67,0.06)' }}>
                        <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
                            <Box>
                                <Typography fontSize={12} color="var(--citron)" textTransform="uppercase" letterSpacing="0.1em" fontWeight={700} display="flex" alignItems="center" gap={0.5}>
                                    <EventIcon sx={{ fontSize: 14 }} /> Current Fight Week
                                </Typography>
                                <Typography fontSize={30} fontWeight={800} color="var(--bone)" fontFamily="var(--font-display)">{season.name}</Typography>
                            </Box>
                            <Box textAlign="right">
                                <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.08em" fontFamily="var(--font-data)">Prize Pot</Typography>
                                <Typography fontSize={28} fontWeight={800} color="var(--citron)" fontFamily="var(--font-data)">{priceFormatter(season.prizePotEth, 4)} BNB</Typography>
                            </Box>
                        </Box>

                        {/* Countdown */}
                        <Box mt={2.5}>
                            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.08em" mb={1} fontFamily="var(--font-data)">
                                {countdown?.ended ? 'Fight Week ended' : 'Ends in'}
                            </Typography>
                            {countdown && !countdown.ended ? (
                                <Box display="flex" gap={1.5} alignItems="center">
                                    <CountdownBlock value={countdown.days} label="Days" />
                                    <CountdownBlock value={countdown.hours} label="Hours" />
                                    <CountdownBlock value={countdown.minutes} label="Mins" />
                                    <CountdownBlock value={countdown.seconds} label="Secs" />
                                </Box>
                            ) : (
                                <Typography fontSize={22} fontWeight={700} color="var(--bone)" display="flex" alignItems="center" gap={0.75}>
                                    <FlagIcon sx={{ fontSize: 22 }} /> Finished
                                </Typography>
                            )}
                        </Box>
                    </Box>

                    {/* Leaderboard */}
                    <Typography color="var(--bone)" fontSize={18} fontWeight={700} fontFamily="var(--font-display)" mb={1.5}>The Rankings</Typography>
                    <Box sx={{ overflowX: 'auto' }}>
                        <Box sx={{ minWidth: 420 }}>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '60px 1fr 140px', px: 2, py: 1, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-data)' }}>
                                <Box>Rank</Box>
                                <Box>Trader</Box>
                                <Box textAlign="right">Points</Box>
                            </Box>
                            {season.leaderboard.length === 0 ? (
                                <Typography color="var(--text-muted)" py={4} textAlign="center">No competitors yet — be the first to climb the board.</Typography>
                            ) : (
                                season.leaderboard.map((e: SeasonEntry) => (
                                    <Box
                                        key={e.address}
                                        sx={{
                                            display: 'grid', gridTemplateColumns: '60px 1fr 140px', alignItems: 'center',
                                            px: 2, py: 1.25, borderRadius: '10px',
                                            border: '1px solid rgba(234,230,218,0.05)', mb: 0.75,
                                            background: e.rank <= 3 ? 'rgba(191,209,67,0.05)' : 'rgba(234,230,218,0.02)',
                                        }}
                                    >
                                        <Typography color={e.rank <= 3 ? 'var(--citron)' : 'var(--muted)'} fontWeight={700} fontSize={15} fontFamily="var(--font-data)">#{e.rank}</Typography>
                                        <Typography color="var(--bone)" fontSize={14} fontWeight={600} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {e.username || shortAddress(e.address)}
                                        </Typography>
                                        <Typography color="var(--citron)" fontSize={14} fontWeight={700} textAlign="right" fontFamily="var(--font-data)">{priceFormatter(e.points, 2)}</Typography>
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
