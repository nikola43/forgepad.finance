'use client'

import { Avatar, Box, Button, CircularProgress, Typography } from "@mui/material"
import GroupAddIcon from '@mui/icons-material/GroupAdd'
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

    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://fyuz.fun'
    const link = summary?.referralCode ? `${origin}/?ref=${summary.referralCode}` : ''

    const copy = async () => {
        if (!link) return
        try { await navigator.clipboard.writeText(link); toast.success('Referral link copied!') }
        catch { toast.error('Copy failed') }
    }
    const share = async () => {
        if (!link) return
        const text = `Trade memecoins on Fyuz and we both earn rewards`
        const tw = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`
        window.open(tw, '_blank')
    }

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <GroupAddIcon sx={{ fontSize: 26 }} /> Referrals
                </Typography>
                <Typography fontSize={13} color="var(--muted)">
                    Invite friends with your link. When they join and trade, you climb the referral board and earn bonus points.
                </Typography>
            </Box>

            {!isConnected ? (
                <Typography color="var(--text-muted)" py={4} textAlign="center">Connect your wallet to get your referral link.</Typography>
            ) : (
                <Box sx={{ p: 2.5, mb: 3, borderRadius: '16px', border: '1px solid rgba(191,209,67,0.25)', background: 'rgba(191,209,67,0.06)' }}>
                    <Typography fontSize={12} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" mb={1} fontFamily="var(--font-data)">Your referral link</Typography>
                    <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
                        <Box sx={{ flex: 1, minWidth: 220, px: 1.5, py: 1, borderRadius: '10px', background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                            <Typography color="var(--citron)" fontSize={13} fontFamily="var(--font-data)" noWrap>{link || 'Generating…'}</Typography>
                        </Box>
                        <Button onClick={copy} sx={{ textTransform: 'none', color: 'var(--moss-black)', background: 'var(--citron)', borderRadius: '10px', px: 2, fontWeight: 700, '&:hover': { background: 'var(--citron)' } }}>Copy</Button>
                        <Button onClick={share} sx={{ textTransform: 'none', color: 'var(--bone)', border: '1px solid rgba(234,230,218,0.2)', borderRadius: '10px', px: 2 }}>Share on X</Button>
                    </Box>
                    <Box display="flex" gap={3} mt={2} flexWrap="wrap">
                        <Box><Typography fontSize={22} fontWeight={800} color="var(--bone)" fontFamily="var(--font-data)">{summary?.referralCount ?? 0}</Typography><Typography fontSize={11} color="var(--muted)" fontFamily="var(--font-data)">Referrals</Typography></Box>
                        <Box><Typography fontSize={22} fontWeight={800} color="var(--bone)" fontFamily="var(--font-data)">${priceFormatter(summary?.refereeVolumeUsd ?? 0, 2)}</Typography><Typography fontSize={11} color="var(--muted)" fontFamily="var(--font-data)">Referee volume</Typography></Box>
                        <Box><Typography fontSize={22} fontWeight={800} color="var(--citron)" fontFamily="var(--font-data)">{priceFormatter(summary?.pointsFromReferrals ?? 0, 0)}</Typography><Typography fontSize={11} color="var(--muted)" fontFamily="var(--font-data)">Points earned</Typography></Box>
                    </Box>
                </Box>
            )}

            {/* Your referees */}
            {isConnected && !!summary?.referees?.length && (
                <Box mb={3}>
                    <Typography color="var(--bone)" fontSize={16} fontWeight={700} fontFamily="var(--font-display)" mb={1}>Your referees</Typography>
                    <Box sx={{ border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                        {summary.referees.map((r) => (
                            <Box key={r.address} onClick={() => router.push(`/profile?address=${r.address}`)} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderTop: '1px solid rgba(234,230,218,0.05)', cursor: 'pointer', '&:hover': { background: 'rgba(234,230,218,0.03)' } }}>
                                <Avatar src={r.avatar || undefined} sx={{ width: 26, height: 26 }} />
                                <Typography color="var(--bone)" fontSize={14} flex={1} noWrap>{r.username || short(r.address)}</Typography>
                                <Typography color="var(--muted)" fontSize={13} fontFamily="var(--font-data)">${priceFormatter(r.volumeUsd, 2)}</Typography>
                            </Box>
                        ))}
                    </Box>
                </Box>
            )}

            {/* Referral leaderboard */}
            <Typography color="var(--bone)" fontSize={18} fontWeight={700} fontFamily="var(--font-display)" mb={1.5}>Top referrers</Typography>
            {entries.length === 0 ? (
                <Typography color="var(--text-muted)" py={4} textAlign="center">No referrals yet — be the first.</Typography>
            ) : (
                <Box sx={{ border: '1px solid var(--border)', borderRadius: '16px', overflow: 'hidden' }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '48px 1fr 110px 130px', gap: 1, px: 2, py: 1.5, background: 'rgba(234,230,218,0.03)', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-data)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        <Box>#</Box><Box>Referrer</Box><Box textAlign="right">Referrals</Box><Box textAlign="right">Referee vol</Box>
                    </Box>
                    {entries.map((e) => (
                        <Box key={e.address} onClick={() => router.push(`/profile?address=${e.address}`)} sx={{ display: 'grid', gridTemplateColumns: '48px 1fr 110px 130px', gap: 1, px: 2, py: 1.5, alignItems: 'center', borderTop: '1px solid rgba(234,230,218,0.05)', cursor: 'pointer', '&:hover': { background: 'rgba(234,230,218,0.03)' } }}>
                            <Box sx={{ fontWeight: 700, fontFamily: 'var(--font-data)', color: e.rank <= 3 ? 'var(--citron)' : 'var(--muted)' }}>{e.rank}</Box>
                            <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                                <Avatar src={e.avatar || undefined} sx={{ width: 28, height: 28 }} />
                                <Typography color="var(--bone)" fontSize={14} noWrap>{e.username || short(e.address)}</Typography>
                            </Box>
                            <Typography textAlign="right" color="var(--citron)" fontSize={14} fontWeight={600} fontFamily="var(--font-data)">{e.referralCount}</Typography>
                            <Typography textAlign="right" color="var(--bone)" fontSize={14} fontFamily="var(--font-data)">${priceFormatter(e.refereeVolumeUsd, 2)}</Typography>
                        </Box>
                    ))}
                </Box>
            )}
        </PageBox>
    )
}
