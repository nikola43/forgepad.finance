'use client'

import { Avatar, Box, Button, CircularProgress, Typography } from "@mui/material"
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import { useReferralSummary, useReferralLeaderboard } from "@/hooks/referrals"
import { useRouter } from "next/navigation"
import toast from "react-hot-toast"

function short(a: string) {
    return `${a.slice(0, 6)}...${a.slice(-4)}`
}

export default function Referrals() {
    const { address, isConnected } = useAppKitAccount()
    const { summary } = useReferralSummary(address)
    const { entries } = useReferralLeaderboard(100)
    const router = useRouter()

    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://arrowpad.io'
    const link = summary?.referralCode ? `${origin}/?ref=${summary.referralCode}` : ''

    const copy = async () => {
        if (!link) return
        try { await navigator.clipboard.writeText(link); toast.success('Referral link copied!') }
        catch { toast.error('Copy failed') }
    }
    const share = async () => {
        if (!link) return
        const text = `Trade memecoins on ArrowPad and we both earn rewards 🚀`
        const tw = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`
        window.open(tw, '_blank')
    }

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">🤝 Referrals</Typography>
                <Typography fontSize={13} color="#94A3B8">
                    Invite friends with your link. When they join and trade, you climb the referral board and earn bonus points.
                </Typography>
            </Box>

            {!isConnected ? (
                <Typography color="#64748B" py={4} textAlign="center">Connect your wallet to get your referral link.</Typography>
            ) : (
                <Box sx={{ p: 2.5, mb: 3, borderRadius: '16px', border: '1px solid rgba(211,255,36,0.25)', background: 'linear-gradient(135deg, rgba(211,255,36,0.10), rgba(211,255,36,0.02))' }}>
                    <Typography fontSize={12} color="#94A3B8" textTransform="uppercase" letterSpacing="0.05em" mb={1}>Your referral link</Typography>
                    <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
                        <Box sx={{ flex: 1, minWidth: 220, px: 1.5, py: 1, borderRadius: '10px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                            <Typography color="#e4ff66" fontSize={13} fontFamily="monospace" noWrap>{link || 'Generating…'}</Typography>
                        </Box>
                        <Button onClick={copy} sx={{ textTransform: 'none', color: '#0a0a0f', background: 'linear-gradient(135deg,#D3FF24,#e4ff66)', borderRadius: '10px', px: 2, fontWeight: 700, '&:hover': { background: 'linear-gradient(135deg,#D3FF24,#e4ff66)' } }}>Copy</Button>
                        <Button onClick={share} sx={{ textTransform: 'none', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '10px', px: 2 }}>Share on X</Button>
                    </Box>
                    <Box display="flex" gap={3} mt={2} flexWrap="wrap">
                        <Box><Typography fontSize={22} fontWeight={800} color="white">{summary?.referralCount ?? 0}</Typography><Typography fontSize={11} color="#94A3B8">Referrals</Typography></Box>
                        <Box><Typography fontSize={22} fontWeight={800} color="white">${priceFormatter(summary?.refereeVolumeUsd ?? 0, 2)}</Typography><Typography fontSize={11} color="#94A3B8">Referee volume</Typography></Box>
                        <Box><Typography fontSize={22} fontWeight={800} color="#e4ff66">{priceFormatter(summary?.pointsFromReferrals ?? 0, 0)}</Typography><Typography fontSize={11} color="#94A3B8">Points earned</Typography></Box>
                    </Box>
                </Box>
            )}

            {/* Your referees */}
            {isConnected && !!summary?.referees?.length && (
                <Box mb={3}>
                    <Typography color="white" fontSize={16} fontWeight={700} mb={1}>Your referees</Typography>
                    <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', overflow: 'hidden' }}>
                        {summary.referees.map((r) => (
                            <Box key={r.address} onClick={() => router.push(`/profile?address=${r.address}`)} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', '&:hover': { background: 'rgba(255,255,255,0.03)' } }}>
                                <Avatar src={r.avatar || undefined} sx={{ width: 26, height: 26 }} />
                                <Typography color="white" fontSize={14} flex={1} noWrap>{r.username || short(r.address)}</Typography>
                                <Typography color="#94A3B8" fontSize={13}>${priceFormatter(r.volumeUsd, 2)}</Typography>
                            </Box>
                        ))}
                    </Box>
                </Box>
            )}

            {/* Referral leaderboard */}
            <Typography color="white" fontSize={18} fontWeight={700} mb={1.5}>Top referrers</Typography>
            {entries.length === 0 ? (
                <Typography color="#64748B" py={4} textAlign="center">No referrals yet — be the first.</Typography>
            ) : (
                <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', overflow: 'hidden' }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '48px 1fr 110px 130px', gap: 1, px: 2, py: 1.5, background: 'rgba(255,255,255,0.03)', fontSize: 12, color: '#64748B', fontWeight: 600 }}>
                        <Box>#</Box><Box>Referrer</Box><Box textAlign="right">Referrals</Box><Box textAlign="right">Referee vol</Box>
                    </Box>
                    {entries.map((e) => (
                        <Box key={e.address} onClick={() => router.push(`/profile?address=${e.address}`)} sx={{ display: 'grid', gridTemplateColumns: '48px 1fr 110px 130px', gap: 1, px: 2, py: 1.5, alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', '&:hover': { background: 'rgba(255,255,255,0.03)' } }}>
                            <Box sx={{ fontWeight: 700, color: e.rank <= 3 ? '#D3FF24' : '#94A3B8' }}>{e.rank}</Box>
                            <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                                <Avatar src={e.avatar || undefined} sx={{ width: 28, height: 28 }} />
                                <Typography color="white" fontSize={14} noWrap>{e.username || short(e.address)}</Typography>
                            </Box>
                            <Typography textAlign="right" color="#e4ff66" fontSize={14} fontWeight={600}>{e.referralCount}</Typography>
                            <Typography textAlign="right" color="white" fontSize={14}>${priceFormatter(e.refereeVolumeUsd, 2)}</Typography>
                        </Box>
                    ))}
                </Box>
            )}
        </PageBox>
    )
}
