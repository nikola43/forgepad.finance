'use client'

import { useEffect, useState } from "react"
import { Box, Typography } from "@mui/material"
import PaidIcon from '@mui/icons-material/Paid'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import Link from "next/link"
import { priceFormatter } from "@/utils/price"
import { useBnbUsd, usePayoutStats, usePot, weiToBnb } from "@/hooks/payouts"

// ---------------------------------------------------------------------------
// The payback strip.
//
// The single most persuasive fact about this platform is that 30% of every
// trading fee is paid back to the people who traded — in BNB, weekly, on-chain.
// It was previously stated only inside the leaderboard, where nobody reads it
// until they already care. This puts the number and the proof link on the front
// page.
//
// It leads with what has ALREADY been paid, because a settled total is evidence
// while a pot is a promise. Before the first round settles it falls back to the
// live pot and a countdown, which is the honest version of the same pitch.
// ---------------------------------------------------------------------------

function useCountdown(target?: number) {
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
    useEffect(() => {
        const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
        return () => clearInterval(id)
    }, [])
    if (!target) return null
    const left = target - now
    if (left <= 0) return 'any moment'
    const d = Math.floor(left / 86400)
    const h = Math.floor((left % 86400) / 3600)
    const m = Math.floor((left % 3600) / 60)
    const s = left % 60
    if (d > 0) return `${d}d ${h}h`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m ${s}s`
}

export default function PaybackStrip() {
    const { stats } = usePayoutStats()
    const { pot } = usePot()
    const bnbUsd = useBnbUsd()
    const countdown = useCountdown(pot?.roundEnd)

    const paid = weiToBnb(stats?.totalPaidWei)
    const hasSettled = (stats?.roundsSettled ?? 0) > 0 && paid > 0

    // Nothing paid and no pot read: there is no honest claim to make, so say
    // nothing rather than render a row of dashes.
    if (!hasSettled && (pot?.potBnb ?? 0) <= 0) return null

    return (
        <Box
            component={Link}
            href="/payouts"
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: { xs: 1.5, sm: 3 },
                flexWrap: 'wrap',
                textDecoration: 'none',
                borderRadius: '16px',
                px: { xs: 2, sm: 3 },
                py: { xs: 1.75, sm: 2 },
                my: 2,
                border: '1px solid rgba(191,209,67,0.25)',
                background: 'rgba(191,209,67,0.06)',
                transition: 'border-color .2s ease, background .2s ease',
                '&:hover': { borderColor: 'rgba(191,209,67,0.5)', background: 'rgba(191,209,67,0.1)' },
            }}
        >
            <PaidIcon sx={{ fontSize: 30, color: 'var(--citron)', flexShrink: 0 }} />

            {hasSettled ? (
                <Box minWidth={0}>
                    <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">
                        Paid back to traders
                    </Typography>
                    <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap">
                        <Typography fontSize={{ xs: 20, sm: 24 }} fontWeight={800} color="var(--citron)" fontFamily="var(--font-data)" lineHeight={1.2}>
                            {priceFormatter(paid, 4)} BNB
                        </Typography>
                        {bnbUsd != null && (
                            <Typography fontSize={14} fontWeight={600} color="var(--text-muted)" fontFamily="var(--font-data)">
                                ≈ ${priceFormatter(paid * bnbUsd, 2)}
                            </Typography>
                        )}
                    </Box>
                    <Typography fontSize={12} color="rgba(234,230,218,0.6)">
                        Across {stats?.roundsSettled} weekly round{stats?.roundsSettled === 1 ? '' : 's'} · every payout on-chain
                    </Typography>
                </Box>
            ) : (
                <Box minWidth={0}>
                    <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">
                        This week&apos;s reward pool
                    </Typography>
                    <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap">
                        <Typography fontSize={{ xs: 20, sm: 24 }} fontWeight={800} color="var(--citron)" fontFamily="var(--font-data)" lineHeight={1.2}>
                            {priceFormatter(pot?.potBnb ?? 0, 6)} BNB
                        </Typography>
                        {bnbUsd != null && pot?.potBnb != null && (
                            <Typography fontSize={14} fontWeight={600} color="var(--text-muted)" fontFamily="var(--font-data)">
                                ≈ ${priceFormatter(pot.potBnb * bnbUsd, 2)}
                            </Typography>
                        )}
                    </Box>
                    <Typography fontSize={12} color="rgba(234,230,218,0.6)">
                        30% of every trading fee, split between traders
                    </Typography>
                </Box>
            )}

            {countdown && (
                <Box ml={{ sm: 'auto' }} textAlign={{ xs: 'left', sm: 'right' }}>
                    <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">
                        Next payout
                    </Typography>
                    <Typography fontSize={{ xs: 16, sm: 18 }} fontWeight={700} color="var(--bone)" fontFamily="var(--font-data)">
                        {countdown}
                    </Typography>
                </Box>
            )}

            <Typography
                fontSize={13}
                fontWeight={600}
                color="var(--citron)"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, ml: { xs: 0, sm: countdown ? 0 : 'auto' } }}
            >
                See the receipts <ArrowForwardIcon sx={{ fontSize: 16 }} />
            </Typography>
        </Box>
    )
}
