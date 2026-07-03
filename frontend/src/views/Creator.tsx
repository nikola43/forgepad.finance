'use client'

import { Avatar, Box, LinearProgress, Typography } from "@mui/material"
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import { useCreatorDashboard } from "@/hooks/creator"
import { useRouter } from "next/navigation"

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <Box sx={{ flex: 1, minWidth: 130, p: 2, borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
            <Typography fontSize={22} fontWeight={800} color="white" fontFamily="'Space Grotesk', sans-serif">{value}</Typography>
            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase" letterSpacing="0.05em">{label}</Typography>
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
                <Typography fontSize={28} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">📊 Creator Dashboard</Typography>
                <Typography fontSize={13} color="#94A3B8">
                    Performance of the tokens you launched. Fees are the 1% platform fee your tokens generated — and each graduation earns you +50 bonus points.
                </Typography>
            </Box>

            {!isConnected ? (
                <Typography color="#64748B" py={4} textAlign="center">Connect your wallet to see your created tokens.</Typography>
            ) : !dashboard ? (
                <Typography color="#64748B" py={4} textAlign="center">Loading…</Typography>
            ) : dashboard.tokens.length === 0 ? (
                <Typography color="#64748B" py={4} textAlign="center">You haven&apos;t created any tokens yet.</Typography>
            ) : (
                <>
                    <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
                        <Stat label="Tokens" value={`${dashboard.tokenCount}`} />
                        <Stat label="Graduated" value={`${dashboard.graduatedCount}`} />
                        <Stat label="Total volume" value={`$${priceFormatter(dashboard.totalVolumeUsd, 2)}`} />
                        <Stat label="Fees generated" value={`$${priceFormatter(dashboard.totalFeesUsd, 2)}`} />
                    </Box>

                    <Box sx={{ display: 'grid', gap: 1.5 }}>
                        {dashboard.tokens.map((t) => (
                            <Box
                                key={t.tokenAddress}
                                onClick={() => router.push(`/token?network=${t.network}&address=${t.tokenAddress}`)}
                                sx={{ p: 2, borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer', '&:hover': { borderColor: 'rgba(211,255,36,0.3)' } }}
                            >
                                <Box display="flex" alignItems="center" gap={1.5} mb={1}>
                                    <Avatar src={t.image || undefined} sx={{ width: 36, height: 36 }} />
                                    <Box flex={1} minWidth={0}>
                                        <Typography color="white" fontSize={15} fontWeight={600} noWrap>{t.name} <span style={{ color: '#64748B' }}>({t.symbol})</span></Typography>
                                        <Typography color="#94A3B8" fontSize={12}>
                                            ${priceFormatter(t.volumeUsd, 2)} vol · ${priceFormatter(t.feesUsd, 2)} fees · {t.holders} holders · {t.uniqueTraders} traders
                                        </Typography>
                                    </Box>
                                    {t.launched
                                        ? <Typography fontSize={12} color="#10B981" fontWeight={700} flexShrink={0}>🎓 Graduated</Typography>
                                        : <Typography fontSize={12} color="#e4ff66" fontWeight={700} flexShrink={0}>{t.progressPct.toFixed(1)}%</Typography>}
                                </Box>
                                {!t.launched && (
                                    <LinearProgress
                                        variant="determinate"
                                        value={Math.min(100, t.progressPct)}
                                        sx={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg,#D3FF24,#e4ff66)' } }}
                                    />
                                )}
                                <Box display="flex" gap={2} mt={1}>
                                    <Typography fontSize={11} color="#10B981">{t.buys} buys</Typography>
                                    <Typography fontSize={11} color="#EF4444">{t.sells} sells</Typography>
                                </Box>
                            </Box>
                        ))}
                    </Box>
                </>
            )}
        </PageBox>
    )
}
