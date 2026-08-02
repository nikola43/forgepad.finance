'use client'

import { Box, Typography } from "@mui/material"
import PaidIcon from '@mui/icons-material/Paid'
import { priceFormatter } from "@/utils/price"
import { estimateTradeEarn, usePot } from "@/hooks/payouts"

// ---------------------------------------------------------------------------
// Per-trade earn cue.
//
// The rebate is the platform's whole differentiator and it was only ever
// explained on the leaderboard, which a trader reads after the fact if at all.
// This puts it at the exact moment of the decision: what this trade earns, and
// what that is worth against the pot as it stands.
//
// Deliberately hedged in the copy ("this round", "~"). The round is still open
// and everyone else is trading into the same pot, so the figure moves. What is
// NOT an estimate is the points number — volume is banked the instant a trade
// lands and is never revalued.
// ---------------------------------------------------------------------------

export default function TradeEarnCue({
    usdNotional,
    nativeSymbol = 'BNB',
    tradeType,
}: {
    usdNotional: number
    nativeSymbol?: string
    tradeType?: string
}) {
    const { pot } = usePot()
    const earn = estimateTradeEarn(usdNotional, pot)

    // Nothing typed, or no price yet — say nothing rather than quote zero.
    if (!earn) return null

    return (
        <Box
            sx={{
                display: 'flex',
                gap: 1,
                alignItems: 'center',
                background: 'rgba(191,209,67,0.08)',
                border: '1px solid rgba(191,209,67,0.2)',
                borderRadius: '8px',
                p: '6px 10px',
                mt: 1,
                width: '100%',
                boxSizing: 'border-box',
            }}
        >
            <PaidIcon sx={{ fontSize: 14, color: 'var(--citron)', flexShrink: 0 }} />
            <Typography fontSize={11} fontFamily="var(--font-data)" color="var(--citron)" fontWeight={500}>
                Earns ~{priceFormatter(earn.points, 0)} pts
                {earn.bnb != null && earn.bnb > 0 && (
                    <> · ≈ {priceFormatter(earn.bnb, 6)} {nativeSymbol} back this round</>
                )}
                {tradeType === 'sell' && <> · sells earn the same as buys</>}
            </Typography>
        </Box>
    )
}
