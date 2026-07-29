'use client'

import { useState } from "react"
import { Box, Button, CircularProgress, LinearProgress, Typography } from "@mui/material"
import TrackChangesIcon from '@mui/icons-material/TrackChanges'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import { useRewards, type Quest } from "@/hooks/rewards"
import toast from "react-hot-toast"

function QuestRow({ q }: { q: Quest }) {
    const pct = Math.min(100, (q.progress / q.target) * 100)
    return (
        <Box sx={{ p: 2, borderRadius: '12px', border: '1px solid rgba(234,230,218,0.06)', background: 'rgba(234,230,218,0.02)', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                <Box>
                    <Typography color="var(--bone)" fontSize={15} fontWeight={600}>{q.title}</Typography>
                    <Typography color="var(--muted)" fontSize={12}>{q.description}</Typography>
                </Box>
                <Box textAlign="right" flexShrink={0}>
                    <Typography color="var(--citron)" fontSize={13} fontWeight={700} fontFamily="var(--font-data)">+{priceFormatter(q.points, 0)} pts</Typography>
                    {q.kind === 'daily' && <Typography color="var(--text-muted)" fontSize={10} textTransform="uppercase" fontFamily="var(--font-data)">Daily</Typography>}
                </Box>
            </Box>
            <LinearProgress
                variant="determinate"
                value={pct}
                sx={{ height: 6, borderRadius: 3, background: 'rgba(234,230,218,0.06)', '& .MuiLinearProgress-bar': { background: 'var(--citron)' } }}
            />
            <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography color="var(--text-muted)" fontSize={11} fontFamily="var(--font-data)">
                    {priceFormatter(q.progress, 2)} / {priceFormatter(q.target, 0)}
                </Typography>
                {q.claimed ? (
                    <Typography color="var(--up)" fontSize={12} fontWeight={600} display="flex" alignItems="center" gap={0.4}>
                        <CheckCircleIcon sx={{ fontSize: 14 }} /> Earned
                    </Typography>
                ) : q.completed ? (
                    // Completed but not yet credited: the indexer grants on the
                    // next trade event. No action is required from the user.
                    <Typography color="var(--citron)" fontSize={12} fontWeight={600}>Crediting…</Typography>
                ) : (
                    <Typography color="var(--text-muted)" fontSize={12}>In progress</Typography>
                )}
            </Box>
        </Box>
    )
}

export default function Rewards() {
    const { address, isConnected } = useAppKitAccount()
    const { rewards } = useRewards(address)

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <TrackChangesIcon sx={{ fontSize: 26 }} /> Rewards
                </Typography>
                <Typography fontSize={13} color="var(--muted)">
                    Complete quests and keep a daily trading streak to earn points. Points convert to weekly BNB rewards — same pool as the leaderboard.
                </Typography>
            </Box>

            {!isConnected ? (
                <Typography color="var(--text-muted)" py={6} textAlign="center">Connect your wallet to see your quests, streak and achievements.</Typography>
            ) : !rewards ? (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress sx={{ color: 'var(--citron)' }} /></Box>
            ) : (
                <>
                    {/* Streak + bonus summary */}
                    <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid rgba(191,209,67,0.25)', background: 'rgba(191,209,67,0.06)' }}>
                            <Typography fontSize={26} fontWeight={800} color="var(--bone)" fontFamily="var(--font-data)" display="flex" alignItems="center" gap={0.5}>
                                <WhatshotIcon sx={{ fontSize: 24 }} /> {rewards.currentStreak}
                            </Typography>
                            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">Day streak · best {rewards.longestStreak}</Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: '14px', border: '1px solid var(--border)', background: 'rgba(234,230,218,0.03)' }}>
                            {/* The leaderboard's number, not the grant subtotal. Showing
                                bonusPoints here put 38 on this screen against 39 on the
                                ranking for the same wallet, which reads as a bug. */}
                            <Typography fontSize={26} fontWeight={800} color="var(--citron)" fontFamily="var(--font-data)">{priceFormatter(rewards.points ?? rewards.bonusPoints, 0)}</Typography>
                            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">Points</Typography>
                        </Box>
                    </Box>

                    {/* Airdrop narrative */}
                    <Box sx={{ p: 2, mb: 3, borderRadius: '14px', border: '1px solid rgba(199,75,142,0.25)', background: 'rgba(199,75,142,0.06)' }}>
                        <Typography fontSize={14} fontWeight={700} color="var(--bone)" display="flex" alignItems="center" gap={0.75}>
                            <CardGiftcardIcon sx={{ fontSize: 17 }} /> Points count toward the future airdrop
                        </Typography>
                        <Typography fontSize={12.5} color="rgba(234,230,218,0.7)" mt={0.5} lineHeight={1.55}>
                            Every point you earn — from trading volume, quests, streaks, referrals and graduations — builds your share of the reward pool today and your weight in any future token distribution. Trade, complete quests, and keep your streak alive to stack more.
                        </Typography>
                    </Box>

                    {/* Quests */}
                    <Typography color="var(--bone)" fontSize={18} fontWeight={700} fontFamily="var(--font-display)" mb={1.5}>Quests</Typography>
                    <Box sx={{ display: 'grid', gap: 1.5, mb: 4 }}>
                        {rewards.quests.map((q) => (
                            <QuestRow key={q.key} q={q} />
                        ))}
                    </Box>

                    {/* Achievements */}
                    <Typography color="var(--bone)" fontSize={18} fontWeight={700} fontFamily="var(--font-display)" mb={1.5}>Achievements</Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' }, gap: 1.5 }}>
                        {rewards.achievements.map((a) => (
                            <Box
                                key={a.key}
                                sx={{
                                    p: 2, borderRadius: '12px', textAlign: 'center',
                                    border: a.earned ? '1px solid rgba(191,209,67,0.35)' : '1px solid rgba(234,230,218,0.06)',
                                    background: a.earned ? 'rgba(191,209,67,0.06)' : 'rgba(234,230,218,0.02)',
                                    opacity: a.earned ? 1 : 0.5,
                                }}
                            >
                                <Typography fontSize={30} sx={{ filter: a.earned ? 'none' : 'grayscale(1)' }}>{a.icon}</Typography>
                                <Typography color="var(--bone)" fontSize={13} fontWeight={600}>{a.title}</Typography>
                                <Typography color="var(--muted)" fontSize={11}>{a.description}</Typography>
                                {a.points > 0 && <Typography color="var(--citron)" fontSize={11} fontWeight={600} fontFamily="var(--font-data)" mt={0.5}>+{priceFormatter(a.points, 0)} pts</Typography>}
                            </Box>
                        ))}
                    </Box>
                </>
            )}
        </PageBox>
    )
}
