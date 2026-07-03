'use client'

import { Avatar, Box, Typography } from "@mui/material"
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import { useSearchParams, useRouter } from "next/navigation"
import { useWallet } from "@/hooks/wallet"
import { usePortfolio } from "@/hooks/portfolio"

const pnlColor = (v: number) => (v > 0 ? '#10B981' : v < 0 ? '#EF4444' : '#94A3B8')
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '-' : '')
function short(a: string) { return `${a.slice(0, 6)}…${a.slice(-4)}` }

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <Box sx={{ flex: 1, minWidth: 120, p: 2, borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
            <Typography fontSize={20} fontWeight={800} color={color || 'white'} fontFamily="'Space Grotesk', sans-serif">{value}</Typography>
            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase">{label}</Typography>
        </Box>
    )
}

export default function Wallet() {
    const { address: connected } = useAppKitAccount()
    const params = useSearchParams()
    const router = useRouter()
    const q = params.get('address')
    const address = q && q !== 'me' ? q : connected || undefined

    const { wallet } = useWallet(address)
    const { portfolio } = usePortfolio(address)

    return (
        <PageBox pt={6} maxWidth="1000px" mx="auto" width="100%">
            {!address ? (
                <Typography color="#64748B" py={6} textAlign="center">Connect a wallet or open a trader to see their stats.</Typography>
            ) : !wallet ? (
                <Typography color="#64748B" py={6} textAlign="center">Loading…</Typography>
            ) : (
                <>
                    <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                        <Avatar src={wallet.avatar || undefined} sx={{ width: 44, height: 44 }} />
                        <Box>
                            <Typography fontSize={20} fontWeight={700} color="white">{wallet.username || short(wallet.address)}</Typography>
                            <Typography fontSize={12} color="#64748B" fontFamily="monospace">{short(wallet.address)}</Typography>
                        </Box>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
                        <Stat label="Total PnL" value={`${sign(wallet.totalPnlUsd)}$${priceFormatter(Math.abs(wallet.totalPnlUsd), 2)}`} color={pnlColor(wallet.totalPnlUsd)} />
                        <Stat label="Win rate" value={`${priceFormatter(wallet.winRate, 0)}%`} />
                        <Stat label="Volume" value={`$${priceFormatter(wallet.volumeUsd, 2, true, true)}`} />
                        <Stat label="Holdings" value={`$${priceFormatter(wallet.holdingValueUsd, 2)}`} />
                        <Stat label="Tokens" value={`${wallet.tokensTraded}`} />
                        <Stat label="Trades" value={`${wallet.tradeCount}`} />
                    </Box>

                    {!!portfolio?.positions?.length && (
                        <>
                            <Typography color="white" fontSize={16} fontWeight={700} mb={1}>Holdings</Typography>
                            <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', overflow: 'hidden' }}>
                                {portfolio.positions.map((p) => (
                                    <Box key={p.tokenAddress} onClick={() => router.push(`/token?network=${p.network}&address=${p.tokenAddress}`)}
                                        sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', '&:hover': { background: 'rgba(255,255,255,0.03)' } }}>
                                        <Avatar src={p.image || undefined} sx={{ width: 28, height: 28 }} />
                                        <Typography fontSize={14} color="white" flex={1} noWrap>{p.symbol}</Typography>
                                        <Typography fontSize={13} color="#94A3B8">${priceFormatter(p.valueUsd, 2)}</Typography>
                                        <Typography fontSize={13} fontWeight={600} color={pnlColor(p.unrealizedPnlPct)} width={70} textAlign="right">{sign(p.unrealizedPnlPct)}{priceFormatter(Math.abs(p.unrealizedPnlPct), 1)}%</Typography>
                                    </Box>
                                ))}
                            </Box>
                        </>
                    )}
                </>
            )}
        </PageBox>
    )
}
