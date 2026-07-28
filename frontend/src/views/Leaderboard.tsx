'use client'

import { useEffect, useState } from "react"
import axios from "axios"
import { API_ENDPOINT } from "@/config"
import { Avatar, Box, CircularProgress, Typography } from "@mui/material"
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import PaidIcon from '@mui/icons-material/Paid'
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useRouter } from "next/navigation"

type Entry = {
    rank: number
    address: string
    username?: string
    avatar?: string
    volumeUsd: number
    trades: number
    points: number
    pointsTotal: number
    pointsProjected: number
    heldUsd: number
    rewardEth: number
}

const cols = '48px 1fr 120px 110px 110px'

export default function Leaderboard() {
    const [rows, setRows] = useState<Entry[] | null>(null)
    const [ethUsd, setEthUsd] = useState<number | null>(null)
    const [potBnb, setPotBnb] = useState<number | null>(null)
    const router = useRouter()

    // Live pot straight off the Distributor's balance. Backend caches it in Redis
    // for 60s, so polling at 30s costs us nothing on the RPC and the card still
    // moves as fees land. Left null on failure so the card hides rather than
    // showing "0 BNB" next to the word pool during a blip.
    useEffect(() => {
        let active = true
        const fetchPot = async () => {
            try {
                const { data } = await axios.get(`${API_ENDPOINT}/distributor/pot`, { timeout: 8000 })
                const p = Number(data?.potBnb)
                if (active) setPotBnb(Number.isFinite(p) ? p : null)
            } catch { if (active) setPotBnb(null) }
        }
        fetchPot()
        const id = setInterval(fetchPot, 30000)
        return () => { active = false; clearInterval(id) }
    }, [])

    useEffect(() => {
        let active = true
        axios
            .get(`${API_ENDPOINT}/users/leaderboard`, { params: { limit: 100 } })
            .then(({ data }) => { if (active) setRows(Array.isArray(data) ? data : []) })
            .catch(() => { if (active) setRows([]) })
        return () => { active = false }
    }, [])

    // Free BNB/USD price for reward conversion (rewards are paid in the native
    // gas token, which is BNB on BSC): Coinbase primary, CoinGecko fallback.
    // Both are public + CORS-enabled (no key). Refreshed every 60s; if both fail
    // we simply hide the USD line rather than block the page.
    useEffect(() => {
        let active = true
        const fetchEthUsd = async () => {
            try {
                const { data } = await axios.get('https://api.coinbase.com/v2/prices/BNB-USD/spot', { timeout: 8000 })
                const p = Number(data?.data?.amount)
                if (active && p > 0) { setEthUsd(p); return }
            } catch { /* fall through */ }
            try {
                const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd', { timeout: 8000 })
                const p = Number(data?.binancecoin?.usd)
                if (active && p > 0) setEthUsd(p)
            } catch { /* leave null; USD hidden */ }
        }
        fetchEthUsd()
        const id = setInterval(fetchEthUsd, 60000)
        return () => { active = false; clearInterval(id) }
    }, [])

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <EmojiEventsIcon sx={{ fontSize: 26 }} /> The Rankings
                </Typography>
                <Typography fontSize={13} color="var(--muted)">
                    Points = the average position you HOLD across the round, plus bonus points from quests and referrals, projected to the round&apos;s close if you keep holding. Holding earns; buying just before the close does not. Rewards = your share of the live pot, split 90% by points and 10% to one random holder.
                </Typography>
            </Box>

            {/* Live pot — the first thing on the page, because it is the reason to
                read the rest of it. Sits above the rankings; the explainer below
                the table carries the detail. */}
            <Box
                sx={{
                    borderRadius: '16px',
                    p: { xs: 2.5, sm: 3 },
                    mb: 3,
                    border: '1px solid rgba(191,209,67,0.25)',
                    background: 'rgba(191,209,67,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                }}
            >
                <PaidIcon sx={{ fontSize: 34, color: 'var(--citron)', flexShrink: 0 }} />
                <Box minWidth={0}>
                    <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">
                        This week&apos;s reward pool
                    </Typography>
                    {potBnb == null ? (
                        <Typography fontSize={{ xs: 24, sm: 30 }} fontWeight={800} color="var(--muted)" fontFamily="var(--font-data)">
                            —
                        </Typography>
                    ) : (
                        <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap">
                            <Typography fontSize={{ xs: 24, sm: 30 }} fontWeight={800} color="var(--citron)" fontFamily="var(--font-data)" lineHeight={1.15}>
                                {priceFormatter(potBnb, 6)} BNB
                            </Typography>
                            {ethUsd != null && (
                                <Typography fontSize={{ xs: 14, sm: 16 }} fontWeight={600} color="var(--text-muted)" fontFamily="var(--font-data)">
                                    ≈ ${priceFormatter(potBnb * ethUsd, 2)}
                                </Typography>
                            )}
                        </Box>
                    )}
                    <Typography fontSize={12} color="rgba(234,230,218,0.6)" mt={0.25}>
                        Live Distributor balance · 90% split by points, 10% to one random qualifying trader
                    </Typography>
                </Box>
            </Box>


            {rows === null ? (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
            ) : rows.length === 0 ? (
                <Typography color="var(--text-muted)" py={6} textAlign="center">No trading activity yet.</Typography>
            ) : (
                <Box sx={{ border: '1px solid var(--border)', borderRadius: '16px', overflow: 'hidden' }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: cols, gap: 1, px: 2, py: 1.5, background: 'rgba(234,230,218,0.03)', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-data)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        <Box>#</Box>
                        <Box>Trader</Box>
                        <Box textAlign="right">Holding</Box>
                        <Box textAlign="right">Points</Box>
                        <Box textAlign="right">Reward</Box>
                    </Box>
                    {rows.map((r) => (
                        <Box
                            key={r.address}
                            onClick={() => router.push(`/profile?address=${r.address}`)}
                            sx={{
                                display: 'grid', gridTemplateColumns: cols, gap: 1, px: 2, py: 1.5, alignItems: 'center',
                                borderTop: '1px solid rgba(234,230,218,0.05)', cursor: 'pointer',
                                '&:hover': { background: 'rgba(234,230,218,0.03)' },
                            }}
                        >
                            <Box sx={{ fontWeight: 700, fontFamily: 'var(--font-data)', color: r.rank <= 3 ? 'var(--citron)' : 'var(--muted)' }}>{r.rank}</Box>
                            <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                                <Avatar src={r.avatar || undefined} sx={{ width: 28, height: 28 }} />
                                <Typography color="var(--bone)" fontSize={14} noWrap>
                                    {r.username || `${r.address.slice(0, 6)}...${r.address.slice(-4)}`}
                                </Typography>
                            </Box>
                            <Box textAlign="right">
                                <Typography color="var(--bone)" fontSize={14} fontFamily="var(--font-data)">${priceFormatter(r.heldUsd ?? 0, 2)}</Typography>
                                <Typography color="var(--text-muted)" fontSize={11} fontFamily="var(--font-data)">${priceFormatter(r.volumeUsd, 2)} traded</Typography>
                            </Box>
                            <Typography textAlign="right" color="var(--citron)" fontSize={14} fontWeight={600} fontFamily="var(--font-data)">{priceFormatter(r.pointsProjected ?? r.points, 2)}</Typography>
                            <Box textAlign="right">
                                <Typography color="var(--up)" fontSize={14} fontWeight={600} fontFamily="var(--font-data)">{priceFormatter(r.rewardEth, 6)} BNB</Typography>
                                {ethUsd != null && (
                                    <Typography color="var(--text-muted)" fontSize={11} fontFamily="var(--font-data)">${(r.rewardEth * ethUsd).toFixed(2)}</Typography>
                                )}
                            </Box>
                        </Box>
                    ))}
                </Box>
            )}
            {/* Rewards explainer — below the table: the rankings are what the
                page is for, and this is the detail you read after them. */}
            <Box
                sx={{
                    position: 'relative',
                    overflow: 'hidden',
                    borderRadius: '16px',
                    p: { xs: 2.5, sm: 3 },
                    mt: 3,
                    border: '1px solid rgba(191,209,67,0.25)',
                    background: 'rgba(191,209,67,0.06)',
                }}
            >
                <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                    <PaidIcon sx={{ fontSize: 30, color: 'var(--citron)', flexShrink: 0 }} />
                    <Box>
                        <Typography fontSize={{ xs: 17, sm: 19 }} fontWeight={800} color="var(--bone)" fontFamily="var(--font-body)" letterSpacing="-0.01em">
                            Trade. Earn points. Get paid every week.
                        </Typography>
                        <Typography fontSize={13.5} color="rgba(234,230,218,0.75)" mt={0.75} lineHeight={1.6}>
                            Every buy and sell carries a flat <b style={{ color: 'var(--citron)' }}>1% fee</b> — and 30% of it flows
                            straight back to traders. You earn <b style={{ color: 'var(--citron)' }}>1 point per $1 you hold for a full
                            round</b> — hold half the week and you earn half — so only real, held positions count and wash trading earns
                            nothing.
                            Each week we pool <b style={{ color: 'var(--citron)' }}>30% of all platform fees</b> and pay it out in{' '}
                            <b style={{ color: 'var(--citron)' }}>BNB</b>, split by your share of points. Only the{' '}
                            <b style={{ color: 'var(--citron)' }}>top 100 traders</b> on this board qualify for a cut — so climb and
                            hold your spot. And every week <b style={{ color: 'var(--citron)' }}>one random qualifying trader wins 10% of
                            the entire pool</b>, on top of their points share. Trade more, hold your conviction, and claim a bigger weekly cut.
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
                            {['1 pt / $1 held per round', 'No wash-trade farming', '1% flat fee', '30% shared weekly', 'Top 100 only', '10% random winner', 'Paid in BNB'].map((chip) => (
                                <Box
                                    key={chip}
                                    sx={{
                                        fontSize: 11.5,
                                        fontWeight: 600,
                                        fontFamily: 'var(--font-data)',
                                        color: 'var(--citron)',
                                        border: '1px solid rgba(191,209,67,0.3)',
                                        background: 'rgba(191,209,67,0.06)',
                                        borderRadius: '100px',
                                        px: 1.25,
                                        py: 0.4,
                                    }}
                                >
                                    {chip}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Box>
            </Box>
        </PageBox>
    )
}
