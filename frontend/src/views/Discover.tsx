'use client'

import { useState } from "react"
import { Avatar, Box, Typography } from "@mui/material"
import ExploreIcon from '@mui/icons-material/Explore'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import FiberNewIcon from '@mui/icons-material/FiberNew'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import SchoolIcon from '@mui/icons-material/School'
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useDiscover } from "@/hooks/discover"
import { useRouter } from "next/navigation"

const TABS = [
    { key: 'trending', label: 'Trending', Icon: WhatshotIcon },
    { key: 'new', label: 'New', Icon: FiberNewIcon },
    { key: 'gainers', label: 'Gainers', Icon: TrendingUpIcon },
    { key: 'graduating', label: 'Graduating', Icon: SchoolIcon },
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
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <ExploreIcon sx={{ fontSize: 26 }} /> The Undercard
                </Typography>
                <Typography fontSize={13} color="var(--muted)">Find the hottest Fyuz tokens — trending, brand new, top gainers, and coins about to graduate.</Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {TABS.map((t) => (
                    <Box key={t.key} onClick={() => setTab(t.key)}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.75, borderRadius: '100px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            color: tab === t.key ? 'var(--moss-black)' : 'var(--muted)',
                            background: tab === t.key ? 'var(--citron)' : 'rgba(234,230,218,0.04)',
                            border: '1px solid rgba(234,230,218,0.06)' }}>
                        <t.Icon sx={{ fontSize: 16 }} /> {t.label}
                    </Box>
                ))}
            </Box>

            {tokens.length === 0 ? (
                <Typography color="var(--text-muted)" py={4} textAlign="center">No tokens match yet.</Typography>
            ) : (
                <Box sx={{ border: '1px solid var(--border)', borderRadius: '16px', overflow: 'hidden' }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr 0.9fr 0.9fr 1fr', gap: 1, px: 2, py: 1.5, background: 'rgba(234,230,218,0.03)', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-data)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        <Box>Token</Box><Box textAlign="right">MC</Box><Box textAlign="right">Vol 24h</Box><Box textAlign="right">Holders</Box><Box textAlign="right">24h</Box>
                    </Box>
                    {tokens.map((t) => (
                        <Box key={`${t.network}:${t.tokenAddress}`} onClick={() => router.push(`/token?network=${t.network}&address=${t.tokenAddress}`)}
                            sx={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr 0.9fr 0.9fr 1fr', gap: 1, px: 2, py: 1.25, alignItems: 'center', borderTop: '1px solid rgba(234,230,218,0.05)', cursor: 'pointer', '&:hover': { background: 'rgba(234,230,218,0.03)' } }}>
                            <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                                <Avatar src={t.image || undefined} sx={{ width: 32, height: 32 }} />
                                <Box minWidth={0}>
                                    <Typography color="var(--bone)" fontSize={14} fontWeight={600} noWrap fontFamily="var(--font-data)">{t.symbol} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {ago(t.createdAt)}</span></Typography>
                                    <Typography color="var(--text-muted)" fontSize={11} noWrap display="flex" alignItems="center" gap={0.4} fontFamily="var(--font-data)">
                                        {t.launched ? (<><SchoolIcon sx={{ fontSize: 12 }} /> graduated</>) : `${priceFormatter(t.graduationPct, 0)}% to grad`} · <span style={{ color: 'var(--up)' }}>{t.buys24h}b</span>/<span style={{ color: 'var(--down)' }}>{t.sells24h}s</span>
                                    </Typography>
                                </Box>
                            </Box>
                            <Typography textAlign="right" color="var(--bone)" fontSize={14} fontFamily="var(--font-data)">${priceFormatter(t.marketcap, 2, true, true)}</Typography>
                            <Typography textAlign="right" color="var(--muted)" fontSize={13} fontFamily="var(--font-data)">${priceFormatter(t.volume24h, 2, true, true)}</Typography>
                            <Typography textAlign="right" color="var(--muted)" fontSize={13} fontFamily="var(--font-data)">{t.holders}</Typography>
                            <Typography textAlign="right" fontSize={13} fontWeight={600} fontFamily="var(--font-data)" color={t.priceChange24h > 0 ? 'var(--up)' : t.priceChange24h < 0 ? 'var(--down)' : 'var(--muted)'}>
                                {t.priceChange24h > 0 ? '+' : ''}{priceFormatter(t.priceChange24h, 1)}%
                            </Typography>
                        </Box>
                    ))}
                </Box>
            )}
        </PageBox>
    )
}
