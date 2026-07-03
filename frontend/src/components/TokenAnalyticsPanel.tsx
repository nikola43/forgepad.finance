'use client'

import { Avatar, Box, Typography } from "@mui/material"
import { useRouter } from "next/navigation"
import { priceFormatter } from "@/utils/price"
import { useTokenAnalytics, useTopTraders } from "@/hooks/analytics"

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
    return (
        <Box sx={{ flex: 1, minWidth: 90, p: 1.25, borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Typography fontSize={15} fontWeight={700} color={warn ? '#EF4444' : 'white'}>{value}</Typography>
            <Typography fontSize={10.5} color="#64748B" textTransform="uppercase" letterSpacing="0.03em">{label}</Typography>
        </Box>
    )
}

function short(a: string) { return `${a.slice(0, 6)}…${a.slice(-4)}` }
const pnlColor = (v: number) => (v > 0 ? '#10B981' : v < 0 ? '#EF4444' : '#94A3B8')

export default function TokenAnalyticsPanel({ network, address }: { network?: string; address?: string }) {
    const { analytics: a } = useTokenAnalytics(network, address)
    const { traders } = useTopTraders(network, address)
    const router = useRouter()
    if (!a) return null

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, my: 2 }}>
            <Box>
                <Typography color="white" fontSize={15} fontWeight={700} mb={1}>Analytics & Safety</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Metric label="Holders" value={`${a.holderCount}`} />
                    <Metric label="Top 10" value={`${priceFormatter(a.top10Pct, 1)}%`} warn={a.top10Pct > 50} />
                    <Metric label="Dev holds" value={`${priceFormatter(a.creatorPct, 1)}%`} warn={a.creatorPct > 20} />
                    <Metric label="Buys/Sells" value={`${a.buys}/${a.sells}`} />
                    <Metric label={a.launched ? 'Status' : 'To grad'} value={a.launched ? '🎓' : `${priceFormatter(a.graduationPct, 0)}%`} />
                    <Metric label="Bundle" value={a.bundleFlag ? `⚠︎ ${a.bundleBuyers}` : 'Clean'} warn={a.bundleFlag} />
                </Box>
            </Box>

            {traders.length > 0 && (
                <Box>
                    <Typography color="white" fontSize={15} fontWeight={700} mb={1}>Top Traders</Typography>
                    <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', overflow: 'hidden' }}>
                        {traders.slice(0, 10).map((t, i) => (
                            <Box key={t.address} onClick={() => router.push(`/wallet?address=${t.address}`)}
                                sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none', cursor: 'pointer', '&:hover': { background: 'rgba(255,255,255,0.03)' } }}>
                                <Typography fontSize={12} color="#64748B" width={18}>{i + 1}</Typography>
                                <Avatar src={t.avatar || undefined} sx={{ width: 22, height: 22 }} />
                                <Typography fontSize={13} color="white" flex={1} noWrap>{t.username || short(t.address)}{t.isCreator ? ' 👑' : ''}</Typography>
                                <Typography fontSize={13} fontWeight={600} color={pnlColor(t.totalPnlUsd)}>{t.totalPnlUsd >= 0 ? '+' : '-'}${priceFormatter(Math.abs(t.totalPnlUsd), 2)}</Typography>
                            </Box>
                        ))}
                    </Box>
                </Box>
            )}
        </Box>
    )
}
