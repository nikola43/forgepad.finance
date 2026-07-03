'use client'

import { Avatar, Box, Typography } from "@mui/material"
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import { usePortfolio } from "@/hooks/portfolio"
import { useRouter } from "next/navigation"

const green = '#10B981'
const red = '#EF4444'
function pnlColor(v: number) { return v > 0 ? green : v < 0 ? red : '#94A3B8' }
function sign(v: number) { return v > 0 ? '+' : '' }

export default function Portfolio() {
    const { address, isConnected } = useAppKitAccount()
    const { portfolio } = usePortfolio(address)
    const router = useRouter()

    return (
        <PageBox pt={6} maxWidth="1000px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">💼 Portfolio</Typography>
                <Typography fontSize={13} color="#94A3B8">Your ArrowPad holdings with live value and realized / unrealized PnL.</Typography>
            </Box>

            {!isConnected ? (
                <Typography color="#64748B" py={4} textAlign="center">Connect your wallet to see your portfolio.</Typography>
            ) : !portfolio ? (
                <Typography color="#64748B" py={4} textAlign="center">Loading…</Typography>
            ) : (
                <>
                    {/* Totals */}
                    <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                            <Typography fontSize={22} fontWeight={800} color="white">${priceFormatter(portfolio.totalValueUsd, 2)}</Typography>
                            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase">Holdings value</Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                            <Typography fontSize={22} fontWeight={800} color={pnlColor(portfolio.totalPnlUsd)}>{sign(portfolio.totalPnlUsd)}${priceFormatter(Math.abs(portfolio.totalPnlUsd), 2)}</Typography>
                            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase">Total PnL ({sign(portfolio.roiPct)}{priceFormatter(portfolio.roiPct, 1)}%)</Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                            <Typography fontSize={22} fontWeight={800} color={pnlColor(portfolio.unrealizedPnlUsd)}>{sign(portfolio.unrealizedPnlUsd)}${priceFormatter(Math.abs(portfolio.unrealizedPnlUsd), 2)}</Typography>
                            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase">Unrealized</Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                            <Typography fontSize={22} fontWeight={800} color={pnlColor(portfolio.realizedPnlUsd)}>{sign(portfolio.realizedPnlUsd)}${priceFormatter(Math.abs(portfolio.realizedPnlUsd), 2)}</Typography>
                            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase">Realized</Typography>
                        </Box>
                    </Box>

                    {portfolio.positions.length === 0 ? (
                        <Typography color="#64748B" py={4} textAlign="center">No open positions. Buy a token to start your portfolio.</Typography>
                    ) : (
                        <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', overflow: 'hidden' }}>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 1, px: 2, py: 1.5, background: 'rgba(255,255,255,0.03)', fontSize: 12, color: '#64748B', fontWeight: 600 }}>
                                <Box>Token</Box><Box textAlign="right">Value</Box><Box textAlign="right">Avg / Now</Box><Box textAlign="right">PnL</Box>
                            </Box>
                            {portfolio.positions.map((pos) => (
                                <Box key={pos.tokenAddress} onClick={() => router.push(`/token?network=${pos.network}&address=${pos.tokenAddress}`)}
                                    sx={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 1, px: 2, py: 1.5, alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', '&:hover': { background: 'rgba(255,255,255,0.03)' } }}>
                                    <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                                        <Avatar src={pos.image || undefined} sx={{ width: 30, height: 30 }} />
                                        <Box minWidth={0}>
                                            <Typography color="white" fontSize={14} fontWeight={600} noWrap>{pos.symbol}</Typography>
                                            <Typography color="#64748B" fontSize={11} noWrap>{priceFormatter(pos.balance, 2, true, true)} tokens</Typography>
                                        </Box>
                                    </Box>
                                    <Typography textAlign="right" color="white" fontSize={14}>${priceFormatter(pos.valueUsd, 2)}</Typography>
                                    <Box textAlign="right">
                                        <Typography color="#94A3B8" fontSize={12}>${priceFormatter(pos.avgBuyPriceUsd, 8)}</Typography>
                                        <Typography color="#e4ff66" fontSize={12}>${priceFormatter(pos.currentPriceUsd, 8)}</Typography>
                                    </Box>
                                    <Box textAlign="right">
                                        <Typography color={pnlColor(pos.unrealizedPnlUsd)} fontSize={14} fontWeight={600}>{sign(pos.unrealizedPnlUsd)}${priceFormatter(Math.abs(pos.unrealizedPnlUsd), 2)}</Typography>
                                        <Typography color={pnlColor(pos.unrealizedPnlPct)} fontSize={11}>{sign(pos.unrealizedPnlPct)}{priceFormatter(pos.unrealizedPnlPct, 1)}%</Typography>
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
