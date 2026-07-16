'use client'

import { Avatar, Box, Typography } from "@mui/material"
import { useNewTrades } from "@/hooks/token"
import { useRouter } from "next/navigation"
import { priceFormatter } from "@/utils/price"

// Live FOMO ticker of recent trades. Fed by useNewTrades (polls /trades/recent
// and refreshes on the socket `m` event), auto-scrolling and pausing on hover.
export default function ActivityTicker() {
    const { trades } = useNewTrades()
    const router = useRouter()
    const items: any[] = (trades ?? []).slice(-24)
    if (!items.length) return null
    const loop = [...items, ...items] // duplicate for a seamless marquee

    return (
        <Box
            sx={{
                overflow: 'hidden',
                borderTop: '1px solid rgba(234,230,218,0.06)',
                borderBottom: '1px solid rgba(234,230,218,0.06)',
                background: 'var(--glass)',
                py: 0.9,
                '&:hover .ticker': { animationPlayState: 'paused' },
            }}
        >
            <Box
                className="ticker"
                sx={{
                    display: 'inline-flex',
                    gap: 3,
                    whiteSpace: 'nowrap',
                    animation: 'tickerScroll 50s linear infinite',
                    '@keyframes tickerScroll': {
                        '0%': { transform: 'translateX(0)' },
                        '100%': { transform: 'translateX(-50%)' },
                    },
                }}
            >
                {loop.map((t, i) => {
                    const usd = Number(t.ethAmount) * Number(t.ethPrice)
                    const buy = String(t.type).toLowerCase() === 'buy'
                    return (
                        <Box
                            key={i}
                            onClick={() => router.push(`/token?network=${t.network}&address=${t.tokenAddress}`)}
                            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, cursor: 'pointer', flexShrink: 0 }}
                        >
                            <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', background: buy ? 'var(--up)' : 'var(--down)', flexShrink: 0 }} />
                            <Typography component="span" fontSize={12} color="var(--muted)" fontFamily="var(--font-data)">{t.swapperUsername || `${String(t.swapperAddress).slice(0, 6)}…`}</Typography>
                            <Typography component="span" fontSize={12} color={buy ? 'var(--up)' : 'var(--down)'} fontWeight={600}>{buy ? 'bought' : 'sold'}</Typography>
                            <Typography component="span" fontSize={12} color="var(--text-primary)" fontFamily="var(--font-data)">${priceFormatter(usd, 2)}</Typography>
                            <Typography component="span" fontSize={12} color="var(--text-muted)">of</Typography>
                            <Avatar src={t.tokenImage || undefined} sx={{ width: 16, height: 16 }} />
                            <Typography component="span" fontSize={12} color="var(--citron)" fontWeight={600} fontFamily="var(--font-data)">{t.tokenSymbol}</Typography>
                        </Box>
                    )
                })}
            </Box>
        </Box>
    )
}
