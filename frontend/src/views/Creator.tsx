'use client'

import { Avatar, Box, LinearProgress, Typography } from "@mui/material"
import BarChartIcon from '@mui/icons-material/BarChart'
import SchoolIcon from '@mui/icons-material/School'
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import { useCreatorDashboard } from "@/hooks/creator"
import { useRouter } from "next/navigation"

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <Box sx={{ flex: 1, minWidth: 130, p: 2, borderRadius: '14px', border: '1px solid var(--border)', background: 'rgba(234,230,218,0.03)' }}>
            <Typography fontSize={22} fontWeight={800} color="var(--bone)" fontFamily="var(--font-data)">{value}</Typography>
            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">{label}</Typography>
        </Box>
    )
}

export default function Creator() {
    const { address, isConnected } = useAppKitAccount()
    const { dashboard } = useCreatorDashboard(address)
    const router = useRouter()

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <BarChartIcon sx={{ fontSize: 26 }} /> Promoter Dashboard
                </Typography>
                <Typography fontSize={13} color="var(--muted)">
                    Performance of the tokens you&apos;ve created. Fees are the 1% platform fee collected on your tokens&apos; trades — and every token that graduates to the DEX earns you +50 bonus points.
                </Typography>
            </Box>

            {!isConnected ? (
                <Typography color="var(--text-muted)" py={4} textAlign="center">Connect your wallet to see your created tokens.</Typography>
            ) : !dashboard ? (
                <Typography color="var(--text-muted)" py={4} textAlign="center">Loading…</Typography>
            ) : dashboard.tokens.length === 0 ? (
                <Typography color="var(--text-muted)" py={4} textAlign="center">You haven&apos;t created any tokens yet.</Typography>
            ) : (
                <>
                    <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
                        <Stat label="Tokens created" value={`${dashboard.tokenCount}`} />
                        <Stat label="Graduated to DEX" value={`${dashboard.graduatedCount}`} />
                        <Stat label="Trading volume" value={`$${priceFormatter(dashboard.totalVolumeUsd, 2)}`} />
                        <Stat label="Fees collected" value={`$${priceFormatter(dashboard.totalFeesUsd, 2)}`} />
                    </Box>

                    <Box sx={{ display: 'grid', gap: 1.5 }}>
                        {dashboard.tokens.map((t) => (
                            <Box
                                key={t.tokenAddress}
                                onClick={() => router.push(`/token?network=${t.network}&address=${t.tokenAddress}`)}
                                sx={{ p: 2, borderRadius: '14px', border: '1px solid var(--border)', background: 'rgba(234,230,218,0.02)', cursor: 'pointer', '&:hover': { borderColor: 'rgba(191,209,67,0.3)' } }}
                            >
                                <Box display="flex" alignItems="center" gap={1.5} mb={1}>
                                    <Avatar src={t.image || undefined} sx={{ width: 36, height: 36 }} />
                                    <Box flex={1} minWidth={0}>
                                        <Typography color="var(--bone)" fontSize={15} fontWeight={600} noWrap>{t.name} <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>({t.symbol})</span></Typography>
                                        <Typography color="var(--muted)" fontSize={12} fontFamily="var(--font-data)">
                                            ${priceFormatter(t.volumeUsd, 2)} vol · ${priceFormatter(t.feesUsd, 2)} fees · {t.holders} holders · {t.uniqueTraders} traders
                                        </Typography>
                                    </Box>
                                    {t.launched
                                        ? <Typography fontSize={12} color="var(--tangerine)" fontWeight={700} flexShrink={0} display="flex" alignItems="center" gap={0.4}><SchoolIcon sx={{ fontSize: 15 }} /> Graduated</Typography>
                                        : <Typography fontSize={12} color="var(--citron)" fontWeight={700} flexShrink={0} fontFamily="var(--font-data)">{t.progressPct.toFixed(1)}%</Typography>}
                                </Box>
                                {!t.launched && (
                                    <LinearProgress
                                        variant="determinate"
                                        value={Math.min(100, t.progressPct)}
                                        sx={{ height: 6, borderRadius: 3, background: 'rgba(234,230,218,0.06)', '& .MuiLinearProgress-bar': { background: 'var(--citron)' } }}
                                    />
                                )}
                                <Box display="flex" gap={2} mt={1}>
                                    <Typography fontSize={11} color="var(--up)" fontFamily="var(--font-data)">{t.buys} buys</Typography>
                                    <Typography fontSize={11} color="var(--down)" fontFamily="var(--font-data)">{t.sells} sells</Typography>
                                </Box>
                            </Box>
                        ))}
                    </Box>
                </>
            )}
        </PageBox>
    )
}
