'use client'

import { Avatar, Box, Typography } from "@mui/material"
import WorkIcon from '@mui/icons-material/Work'
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import { usePortfolio } from "@/hooks/portfolio"
import { useRouter } from "next/navigation"

const green = 'var(--up)'
const red = 'var(--down)'
function pnlColor(v: number) { return v > 0 ? green : v < 0 ? red : 'var(--muted)' }
function sign(v: number) { return v > 0 ? '+' : '' }

export default function Portfolio() {
    const { address, isConnected } = useAppKitAccount()
    const { portfolio } = usePortfolio(address)
    const router = useRouter()

    return (
        <PageBox pt={6} maxWidth="1000px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <WorkIcon sx={{ fontSize: 26 }} /> Portfolio
                </Typography>
                <Typography fontSize={13} color="var(--muted)">Your Fyuz holdings with live value and realized / unrealized PnL.</Typography>
            </Box>

            {!isConnected ? (
                <Typography color="var(--text-muted)" py={4} textAlign="center">Connect your wallet to see your portfolio.</Typography>
            ) : !portfolio ? (
                <Typography color="var(--text-muted)" py={4} textAlign="center">Loading…</Typography>
            ) : (
                <>
                    {/* Totals */}
                    <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid var(--border)', background: 'rgba(234,230,218,0.03)' }}>
                            <Typography fontSize={22} fontWeight={800} color="var(--bone)" fontFamily="var(--font-data)">${priceFormatter(portfolio.totalValueUsd, 2)}</Typography>
                            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" fontFamily="var(--font-data)">Holdings value</Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid var(--border)', background: 'rgba(234,230,218,0.03)' }}>
                            <Typography fontSize={22} fontWeight={800} color={pnlColor(portfolio.totalPnlUsd)} fontFamily="var(--font-data)">{sign(portfolio.totalPnlUsd)}${priceFormatter(Math.abs(portfolio.totalPnlUsd), 2)}</Typography>
                            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" fontFamily="var(--font-data)">Total PnL ({sign(portfolio.roiPct)}{priceFormatter(portfolio.roiPct, 1)}%)</Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid var(--border)', background: 'rgba(234,230,218,0.03)' }}>
                            <Typography fontSize={22} fontWeight={800} color={pnlColor(portfolio.unrealizedPnlUsd)} fontFamily="var(--font-data)">{sign(portfolio.unrealizedPnlUsd)}${priceFormatter(Math.abs(portfolio.unrealizedPnlUsd), 2)}</Typography>
                            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" fontFamily="var(--font-data)">Unrealized</Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid var(--border)', background: 'rgba(234,230,218,0.03)' }}>
                            <Typography fontSize={22} fontWeight={800} color={pnlColor(portfolio.realizedPnlUsd)} fontFamily="var(--font-data)">{sign(portfolio.realizedPnlUsd)}${priceFormatter(Math.abs(portfolio.realizedPnlUsd), 2)}</Typography>
                            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" fontFamily="var(--font-data)">Realized</Typography>
                        </Box>
                    </Box>

                    {portfolio.positions.length === 0 ? (
                        <Typography color="var(--text-muted)" py={4} textAlign="center">No open positions. Buy a token to start your portfolio.</Typography>
                    ) : (
                        <Box sx={{ border: '1px solid var(--border)', borderRadius: '16px', overflow: 'hidden' }}>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 1, px: 2, py: 1.5, background: 'rgba(234,230,218,0.03)', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-data)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                <Box>Token</Box><Box textAlign="right">Value</Box><Box textAlign="right">Avg / Now</Box><Box textAlign="right">PnL</Box>
                            </Box>
                            {portfolio.positions.map((pos) => (
                                <Box key={pos.tokenAddress} onClick={() => router.push(`/token?network=${pos.network}&address=${pos.tokenAddress}`)}
                                    sx={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 1, px: 2, py: 1.5, alignItems: 'center', borderTop: '1px solid rgba(234,230,218,0.05)', cursor: 'pointer', '&:hover': { background: 'rgba(234,230,218,0.03)' } }}>
                                    <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                                        <Avatar src={pos.image || undefined} sx={{ width: 30, height: 30 }} />
                                        <Box minWidth={0}>
                                            <Typography color="var(--bone)" fontSize={14} fontWeight={600} noWrap fontFamily="var(--font-data)">{pos.symbol}</Typography>
                                            <Typography color="var(--text-muted)" fontSize={11} noWrap fontFamily="var(--font-data)">{priceFormatter(pos.balance, 2, true, true)} tokens</Typography>
                                        </Box>
                                    </Box>
                                    <Typography textAlign="right" color="var(--bone)" fontSize={14} fontFamily="var(--font-data)">${priceFormatter(pos.valueUsd, 2)}</Typography>
                                    <Box textAlign="right">
                                        <Typography color="var(--muted)" fontSize={12} fontFamily="var(--font-data)">${priceFormatter(pos.avgBuyPriceUsd, 8)}</Typography>
                                        <Typography color="var(--citron)" fontSize={12} fontFamily="var(--font-data)">${priceFormatter(pos.currentPriceUsd, 8)}</Typography>
                                    </Box>
                                    <Box textAlign="right">
                                        <Typography color={pnlColor(pos.unrealizedPnlUsd)} fontSize={14} fontWeight={600} fontFamily="var(--font-data)">{sign(pos.unrealizedPnlUsd)}${priceFormatter(Math.abs(pos.unrealizedPnlUsd), 2)}</Typography>
                                        <Typography color={pnlColor(pos.unrealizedPnlPct)} fontSize={11} fontFamily="var(--font-data)">{sign(pos.unrealizedPnlPct)}{priceFormatter(pos.unrealizedPnlPct, 1)}%</Typography>
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    )}
                </>
            )}
        </PageBox>
    )
}
