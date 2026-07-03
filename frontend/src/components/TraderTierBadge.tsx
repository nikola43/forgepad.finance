'use client'

import { Box, LinearProgress, Typography } from "@mui/material"
import { priceFormatter } from "@/utils/price"
import { useTier } from "@/hooks/tier"

// Per-tier accent colors used for the pill and progress bar.
const TIER_COLORS: Record<string, { fg: string; bg: string; border: string; bar: string }> = {
    Bronze: { fg: '#E6A15A', bg: 'rgba(205,127,50,0.12)', border: 'rgba(205,127,50,0.35)', bar: 'linear-gradient(90deg,#CD7F32,#E6A15A)' },
    Silver: { fg: '#CBD5E1', bg: 'rgba(203,213,225,0.12)', border: 'rgba(203,213,225,0.35)', bar: 'linear-gradient(90deg,#94A3B8,#E2E8F0)' },
    Gold: { fg: '#F5D061', bg: 'rgba(245,208,97,0.12)', border: 'rgba(245,208,97,0.38)', bar: 'linear-gradient(90deg,#E5B93C,#F7DE82)' },
    Diamond: { fg: '#67E8F9', bg: 'rgba(103,232,249,0.12)', border: 'rgba(103,232,249,0.38)', bar: 'linear-gradient(90deg,#22D3EE,#A5F3FC)' },
}

export default function TraderTierBadge({ address }: { address?: string }) {
    const { tier } = useTier(address)

    if (!tier) return null

    const colors = TIER_COLORS[tier.tier] ?? TIER_COLORS.Bronze

    return (
        <Box sx={{ p: 2, borderRadius: '14px', border: `1px solid ${colors.border}`, background: colors.bg, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                <Box sx={{ px: 1.5, py: 0.5, borderRadius: '999px', border: `1px solid ${colors.border}`, background: 'rgba(0,0,0,0.25)' }}>
                    <Typography fontSize={14} fontWeight={800} color={colors.fg} letterSpacing="0.04em" textTransform="uppercase">
                        {tier.tier}
                    </Typography>
                </Box>
                <Box textAlign="right">
                    <Typography fontSize={16} fontWeight={800} color="#fff">${priceFormatter(tier.volumeUsd, 2)}</Typography>
                    <Typography fontSize={10} color="#94A3B8" textTransform="uppercase" letterSpacing="0.05em">Lifetime volume</Typography>
                </Box>
            </Box>

            <LinearProgress
                variant="determinate"
                value={Math.min(100, Math.max(0, tier.progressPct))}
                sx={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', '& .MuiLinearProgress-bar': { background: colors.bar } }}
            />

            <Typography fontSize={11} color="#64748B">
                {tier.nextTier && tier.nextThresholdUsd != null
                    ? `${priceFormatter(tier.progressPct, 0)}% to ${tier.nextTier} · $${priceFormatter(tier.nextThresholdUsd, 0)}`
                    : 'Top tier reached — Diamond'}
            </Typography>
        </Box>
    )
}
