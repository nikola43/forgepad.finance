'use client'

import { Avatar, Box, IconButton, Typography } from "@mui/material"
import StarIcon from '@mui/icons-material/Star'
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import { useWatchlist } from "@/hooks/watchlist"
import { useRouter } from "next/navigation"

export default function Watchlist() {
    const { address, isConnected } = useAppKitAccount()
    const { watchlist, toggle } = useWatchlist(address)
    const router = useRouter()

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">⭐ Watchlist</Typography>
                <Typography fontSize={13} color="#94A3B8">Tokens you starred. Tap a token to trade, or the star to remove it.</Typography>
            </Box>

            {!isConnected ? (
                <Typography color="#64748B" py={4} textAlign="center">Connect your wallet to build a watchlist.</Typography>
            ) : watchlist.length === 0 ? (
                <Typography color="#64748B" py={4} textAlign="center">No tokens yet — star a token from its page to add it here.</Typography>
            ) : (
                <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', overflow: 'hidden' }}>
                    {watchlist.map((t) => (
                        <Box key={`${t.network}:${t.tokenAddress}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderTop: '1px solid rgba(255,255,255,0.05)', '&:hover': { background: 'rgba(255,255,255,0.03)' } }}>
                            <Box display="flex" alignItems="center" gap={1.5} flex={1} minWidth={0} sx={{ cursor: 'pointer' }} onClick={() => router.push(`/token?network=${t.network}&address=${t.tokenAddress}`)}>
                                <Avatar src={t.image || undefined} sx={{ width: 34, height: 34 }} />
                                <Box minWidth={0}>
                                    <Typography color="white" fontSize={15} fontWeight={600} noWrap>{t.name} <span style={{ color: '#64748B' }}>({t.symbol})</span></Typography>
                                    <Typography color="#94A3B8" fontSize={12}>MC ${priceFormatter(t.marketcap, 2)}</Typography>
                                </Box>
                            </Box>
                            <IconButton size="small" onClick={() => toggle(t.tokenAddress, t.network)} sx={{ color: '#e4ff66' }}>
                                <StarIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    ))}
                </Box>
            )}
        </PageBox>
    )
}
