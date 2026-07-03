'use client'

import { useState } from "react"
import { Box, Button, CircularProgress, LinearProgress, Typography } from "@mui/material"
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import { useRewards, type Quest } from "@/hooks/rewards"
import toast from "react-hot-toast"

function QuestRow({ q, onClaim, claiming }: { q: Quest; onClaim: () => void; claiming: boolean }) {
    const pct = Math.min(100, (q.progress / q.target) * 100)
    return (
        <Box sx={{ p: 2, borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                <Box>
                    <Typography color="white" fontSize={15} fontWeight={600}>{q.title}</Typography>
                    <Typography color="#94A3B8" fontSize={12}>{q.description}</Typography>
                </Box>
                <Box textAlign="right" flexShrink={0}>
                    <Typography color="#e4ff66" fontSize={13} fontWeight={700}>+{priceFormatter(q.points, 0)} pts</Typography>
                    {q.kind === 'daily' && <Typography color="#64748B" fontSize={10} textTransform="uppercase">Daily</Typography>}
                </Box>
            </Box>
            <LinearProgress
                variant="determinate"
                value={pct}
                sx={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg,#D3FF24,#e4ff66)' } }}
            />
            <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography color="#64748B" fontSize={11}>
                    {priceFormatter(q.progress, 2)} / {priceFormatter(q.target, 0)}
                </Typography>
                {q.claimed ? (
                    <Typography color="#10B981" fontSize={12} fontWeight={600}>✓ Claimed</Typography>
                ) : q.completed ? (
                    <Button
                        size="small"
                        disabled={claiming}
                        onClick={onClaim}
                        sx={{ textTransform: 'none', color: '#0a0a0f', background: 'linear-gradient(135deg,#D3FF24,#e4ff66)', borderRadius: '8px', px: 1.5, py: 0.25, fontWeight: 700, '&:hover': { background: 'linear-gradient(135deg,#D3FF24,#e4ff66)' } }}
                    >
                        {claiming ? <CircularProgress size={14} sx={{ color: '#0a0a0f' }} /> : 'Claim'}
                    </Button>
                ) : (
                    <Typography color="#64748B" fontSize={12}>In progress</Typography>
                )}
            </Box>
        </Box>
    )
}

export default function Rewards() {
    const { address, isConnected } = useAppKitAccount()
    const { rewards, claim } = useRewards(address)
    const [claiming, setClaiming] = useState<string | null>(null)

    const doClaim = async (key: string) => {
        setClaiming(key)
        try {
            await claim(key)
            toast.success('Points claimed!')
        } catch (e: any) {
            toast.error(e?.response?.data?.error || e?.message || 'Claim failed')
        } finally {
            setClaiming(null)
        }
    }

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">🎯 Rewards</Typography>
                <Typography fontSize={13} color="#94A3B8">
                    Complete quests and keep a daily trading streak to earn points. Points convert to weekly ETH rewards — same pool as the leaderboard.
                </Typography>
            </Box>

            {!isConnected ? (
                <Typography color="#64748B" py={6} textAlign="center">Connect your wallet to see your quests, streak and achievements.</Typography>
            ) : !rewards ? (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress sx={{ color: '#D3FF24' }} /></Box>
            ) : (
                <>
                    {/* Streak + bonus summary */}
                    <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid rgba(211,255,36,0.25)', background: 'linear-gradient(135deg, rgba(211,255,36,0.10), rgba(211,255,36,0.02))' }}>
                            <Typography fontSize={26} fontWeight={800} color="#fff">🔥 {rewards.currentStreak}</Typography>
                            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase" letterSpacing="0.05em">Day streak · best {rewards.longestStreak}</Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                            <Typography fontSize={26} fontWeight={800} color="#e4ff66">{priceFormatter(rewards.bonusPoints, 0)}</Typography>
                            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase" letterSpacing="0.05em">Bonus points earned</Typography>
                        </Box>
                    </Box>

                    {/* Airdrop narrative */}
                    <Box sx={{ p: 2, mb: 3, borderRadius: '14px', border: '1px solid rgba(139,92,246,0.25)', background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(139,92,246,0.02))' }}>
                        <Typography fontSize={14} fontWeight={700} color="#fff">🪂 Points count toward the future airdrop</Typography>
                        <Typography fontSize={12.5} color="rgba(255,255,255,0.7)" mt={0.5} lineHeight={1.55}>
                            Every point you earn — from net trading volume, quests, streaks, referrals and graduations — builds your share of the reward pool today and your weight in any future token distribution. Trade, complete quests, and keep your streak alive to stack more.
                        </Typography>
                    </Box>

                    {/* Quests */}
                    <Typography color="white" fontSize={18} fontWeight={700} mb={1.5}>Quests</Typography>
                    <Box sx={{ display: 'grid', gap: 1.5, mb: 4 }}>
                        {rewards.quests.map((q) => (
                            <QuestRow key={q.key} q={q} claiming={claiming === q.key} onClaim={() => doClaim(q.key)} />
                        ))}
                    </Box>

                    {/* Achievements */}
                    <Typography color="white" fontSize={18} fontWeight={700} mb={1.5}>Achievements</Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' }, gap: 1.5 }}>
                        {rewards.achievements.map((a) => (
                            <Box
                                key={a.key}
                                sx={{
                                    p: 2, borderRadius: '12px', textAlign: 'center',
                                    border: a.earned ? '1px solid rgba(211,255,36,0.35)' : '1px solid rgba(255,255,255,0.06)',
                                    background: a.earned ? 'rgba(211,255,36,0.06)' : 'rgba(255,255,255,0.02)',
                                    opacity: a.earned ? 1 : 0.5,
                                }}
                            >
                                <Typography fontSize={30} sx={{ filter: a.earned ? 'none' : 'grayscale(1)' }}>{a.icon}</Typography>
                                <Typography color="white" fontSize={13} fontWeight={600}>{a.title}</Typography>
                                <Typography color="#94A3B8" fontSize={11}>{a.description}</Typography>
                                {a.points > 0 && <Typography color="#e4ff66" fontSize={11} fontWeight={600} mt={0.5}>+{priceFormatter(a.points, 0)} pts</Typography>}
                            </Box>
                        ))}
                    </Box>
                </>
            )}
        </PageBox>
    )
}
