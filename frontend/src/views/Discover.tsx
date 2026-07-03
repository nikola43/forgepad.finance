'use client'

import { useState } from "react"
import { Avatar, Box, Typography } from "@mui/material"
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useDiscover } from "@/hooks/discover"
import { useRouter } from "next/navigation"

const TABS = [
    { key: 'trending', label: '🔥 Trending' },
    { key: 'new', label: '🆕 New' },
    { key: 'gainers', label: '📈 Gainers' },
    { key: 'graduating', label: '🎓 Graduating' },
]

function ago(unix: number) {
    const s = Math.max(0, Math.floor(Date.now() / 1000) - unix)
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m`
    if (s < 86400) return `${Math.floor(s / 3600)}h`
    return `${Math.floor(s / 86400)}d`
}

export default function Discover() {
    const [tab, setTab] = useState('trending')
    const { tokens } = useDiscover({ tab, limit: 60 })
    const router = useRouter()

    return (
        <PageBox pt={6} maxWidth="1000px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">🔭 Discover</Typography>
                <Typography fontSize={13} color="#94A3B8">Find the hottest ArrowPad tokens — trending, brand new, top gainers, and coins about to graduate.</Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {TABS.map((t) => (
                    <Box key={t.key} onClick={() => setTab(t.key)}
                        sx={{ px: 1.5, py: 0.75, borderRadius: '100px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            color: tab === t.key ? '#0a0a0f' : '#94A3B8',
                            background: tab === t.key ? 'linear-gradient(135deg,#D3FF24,#e4ff66)' : 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.06)' }}>
                        {t.label}
                    </Box>
                ))}
            </Box>

            {tokens.length === 0 ? (
                <Typography color="#64748B" py={4} textAlign="center">No tokens match yet.</Typography>
            ) : (
                <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', overflow: 'hidden' }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr 0.9fr 0.9fr 1fr', gap: 1, px: 2, py: 1.5, background: 'rgba(255,255,255,0.03)', fontSize: 12, color: '#64748B', fontWeight: 600 }}>
                        <Box>Token</Box><Box textAlign="right">MC</Box><Box textAlign="right">Vol 24h</Box><Box textAlign="right">Holders</Box><Box textAlign="right">24h</Box>
                    </Box>
                    {tokens.map((t) => (
                        <Box key={`${t.network}:${t.tokenAddress}`} onClick={() => router.push(`/token?network=${t.network}&address=${t.tokenAddress}`)}
                            sx={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr 0.9fr 0.9fr 1fr', gap: 1, px: 2, py: 1.25, alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', '&:hover': { background: 'rgba(255,255,255,0.03)' } }}>
                            <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                                <Avatar src={t.image || undefined} sx={{ width: 32, height: 32 }} />
                                <Box minWidth={0}>
                                    <Typography color="white" fontSize={14} fontWeight={600} noWrap>{t.symbol} <span style={{ color: '#64748B', fontWeight: 400 }}>· {ago(t.createdAt)}</span></Typography>
                                    <Typography color="#64748B" fontSize={11} noWrap>
                                        {t.launched ? '🎓 graduated' : `${priceFormatter(t.graduationPct, 0)}% to grad`} · <span style={{ color: '#10B981' }}>{t.buys24h}b</span>/<span style={{ color: '#EF4444' }}>{t.sells24h}s</span>
                                    </Typography>
                                </Box>
                            </Box>
                            <Typography textAlign="right" color="white" fontSize={14}>${priceFormatter(t.marketcap, 2, true, true)}</Typography>
                            <Typography textAlign="right" color="#94A3B8" fontSize={13}>${priceFormatter(t.volume24h, 2, true, true)}</Typography>
                            <Typography textAlign="right" color="#94A3B8" fontSize={13}>{t.holders}</Typography>
                            <Typography textAlign="right" fontSize={13} fontWeight={600} color={t.priceChange24h > 0 ? '#10B981' : t.priceChange24h < 0 ? '#EF4444' : '#94A3B8'}>
                                {t.priceChange24h > 0 ? '+' : ''}{priceFormatter(t.priceChange24h, 1)}%
                            </Typography>
                        </Box>
                    ))}
                </Box>
            )}
        </PageBox>
    )
}
