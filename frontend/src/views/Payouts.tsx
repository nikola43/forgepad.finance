'use client'

import { useState } from "react"
import { Avatar, Box, CircularProgress, Collapse, Typography } from "@mui/material"
import PaidIcon from '@mui/icons-material/Paid'
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PageBox from "@/components/layout/pageBox"
import ClaimableBanner from "@/components/ClaimableBanner"
import { priceFormatter } from "@/utils/price"
import { useMainContext } from "@/context"
import {
    useAddressPayouts,
    useBnbUsd,
    usePayoutRound,
    usePayoutRounds,
    usePayoutStats,
    weiToBnb,
    type RoundReceipt,
} from "@/hooks/payouts"
import { useAppKitAccount } from "@reown/appkit/react"

// ---------------------------------------------------------------------------
// The receipts page.
//
// Every launchpad says it rewards traders. This one can show the transactions.
// Each round below is a settled on-chain payout: what the pot was, who received
// what, which wallet won the random draw and the VRF word that chose it — all of
// it linked to the explorer so none of it has to be taken on faith.
// ---------------------------------------------------------------------------

const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`

const fmtDate = (unix?: number | null) =>
    unix ? new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <Box
            sx={{
                flex: '1 1 180px',
                minWidth: 0,
                borderRadius: '16px',
                p: { xs: 2, sm: 2.5 },
                border: '1px solid rgba(191,209,67,0.25)',
                background: 'rgba(191,209,67,0.06)',
            }}
        >
            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">
                {label}
            </Typography>
            <Typography fontSize={{ xs: 22, sm: 26 }} fontWeight={800} color="var(--citron)" fontFamily="var(--font-data)" lineHeight={1.2} sx={{ overflowWrap: 'anywhere' }}>
                {value}
            </Typography>
            {sub && (
                <Typography fontSize={12} color="rgba(234,230,218,0.6)" mt={0.25}>
                    {sub}
                </Typography>
            )}
        </Box>
    )
}

/** One settled round, collapsed to a summary row and expandable to the full split. */
function RoundRow({ round, explorerUrl, bnbUsd }: { round: RoundReceipt; explorerUrl?: string; bnbUsd?: number }) {
    const [open, setOpen] = useState(false)
    // Recipients are only fetched once a row is actually opened — a round can
    // carry up to 100 lines and most visitors expand at most one.
    const { round: detail, isLoading } = usePayoutRound(open ? round.roundId : null)

    const pot = weiToBnb(round.potWei)
    const distributed = weiToBnb(round.distributedWei)
    const winnerAmount = weiToBnb(round.winnerAmountWei)
    const explorer = explorerUrl?.replace(/\/$/, '')

    return (
        <Box sx={{ borderTop: '1px solid rgba(234,230,218,0.05)' }}>
            <Box
                onClick={() => setOpen(o => !o)}
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr auto', sm: '80px 1fr 140px 120px 40px' },
                    gap: 1,
                    px: 2,
                    py: 1.75,
                    alignItems: 'center',
                    cursor: 'pointer',
                    '&:hover': { background: 'rgba(234,230,218,0.03)' },
                }}
            >
                <Box>
                    <Typography color="var(--citron)" fontSize={14} fontWeight={700} fontFamily="var(--font-data)">
                        #{round.roundId}
                    </Typography>
                    <Typography color="var(--text-muted)" fontSize={11} fontFamily="var(--font-data)" display={{ xs: 'block', sm: 'none' }}>
                        {fmtDate(round.distributedAt ?? round.timeEnd)}
                    </Typography>
                </Box>
                <Box display={{ xs: 'none', sm: 'block' }} minWidth={0}>
                    <Typography color="var(--bone)" fontSize={14}>
                        {fmtDate(round.timeStart)} → {fmtDate(round.timeEnd)}
                    </Typography>
                    <Typography color="var(--text-muted)" fontSize={11} fontFamily="var(--font-data)">
                        {round.holderCount ?? 0} trader{round.holderCount === 1 ? '' : 's'} paid
                    </Typography>
                </Box>
                <Box textAlign={{ xs: 'right', sm: 'right' }}>
                    <Typography color="var(--up)" fontSize={14} fontWeight={700} fontFamily="var(--font-data)">
                        {priceFormatter(pot, 6)} BNB
                    </Typography>
                    {bnbUsd != null && (
                        <Typography color="var(--text-muted)" fontSize={11} fontFamily="var(--font-data)">
                            ${priceFormatter(pot * bnbUsd, 2)}
                        </Typography>
                    )}
                </Box>
                <Box display={{ xs: 'none', sm: 'block' }} textAlign="right">
                    {round.winnerAddress ? (
                        <>
                            <Typography color="var(--citron)" fontSize={13} fontFamily="var(--font-data)" noWrap>
                                {shortAddr(round.winnerAddress)}
                            </Typography>
                            <Typography color="var(--text-muted)" fontSize={11} fontFamily="var(--font-data)">
                                won {priceFormatter(winnerAmount, 6)}
                            </Typography>
                        </>
                    ) : (
                        <Typography color="var(--text-muted)" fontSize={13}>—</Typography>
                    )}
                </Box>
                <Box display={{ xs: 'none', sm: 'flex' }} justifyContent="flex-end" color="var(--muted)">
                    {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </Box>
            </Box>

            <Collapse in={open} unmountOnExit>
                <Box sx={{ px: 2, pb: 2.5, background: 'rgba(234,230,218,0.02)' }}>
                    {/* The split, stated plainly: 90% by points, 10% to one drawn wallet. */}
                    <Box display="flex" flexWrap="wrap" gap={2} py={2}>
                        <Box>
                            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" fontFamily="var(--font-data)">Pot</Typography>
                            <Typography fontSize={15} color="var(--bone)" fontFamily="var(--font-data)" fontWeight={700}>{priceFormatter(pot, 8)} BNB</Typography>
                        </Box>
                        <Box>
                            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" fontFamily="var(--font-data)">Split by points (90%)</Typography>
                            <Typography fontSize={15} color="var(--bone)" fontFamily="var(--font-data)" fontWeight={700}>{priceFormatter(distributed, 8)} BNB</Typography>
                        </Box>
                        <Box>
                            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" fontFamily="var(--font-data)">Random winner (10%)</Typography>
                            <Typography fontSize={15} color="var(--citron)" fontFamily="var(--font-data)" fontWeight={700}>{priceFormatter(winnerAmount, 8)} BNB</Typography>
                        </Box>
                    </Box>

                    <Box display="flex" flexWrap="wrap" gap={2} alignItems="center" pb={1.5}>
                        {explorer && round.txHash && (
                            <a
                                href={`${explorer}/tx/${round.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--citron)', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                                Payout transaction <OpenInNewIcon sx={{ fontSize: 14 }} />
                            </a>
                        )}
                        {round.vrfRandom && round.vrfRandom !== '0' && (
                            <Typography fontSize={12} color="var(--text-muted)" fontFamily="var(--font-data)" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, overflowWrap: 'anywhere' }}>
                                <CasinoOutlinedIcon sx={{ fontSize: 15 }} />
                                Chainlink VRF word {round.vrfRandom.slice(0, 12)}…
                            </Typography>
                        )}
                    </Box>

                    {isLoading && !detail ? (
                        <Box display="flex" justifyContent="center" py={3}><CircularProgress size={22} /></Box>
                    ) : !detail?.payouts?.length ? (
                        <Typography color="var(--text-muted)" fontSize={13} py={2}>
                            No per-trader lines recorded for this round yet.
                        </Typography>
                    ) : (
                        <Box sx={{ border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 100px 140px', gap: 1, px: 1.5, py: 1, background: 'rgba(234,230,218,0.03)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-data)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                <Box>Trader</Box>
                                <Box textAlign="right">Share</Box>
                                <Box textAlign="right">Paid</Box>
                            </Box>
                            {detail.payouts.map(p => (
                                <Box
                                    key={p.address}
                                    sx={{ display: 'grid', gridTemplateColumns: '1fr 100px 140px', gap: 1, px: 1.5, py: 1, alignItems: 'center', borderTop: '1px solid rgba(234,230,218,0.05)' }}
                                >
                                    <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                                        <Avatar src={p.avatar || undefined} sx={{ width: 22, height: 22 }} />
                                        <Typography color="var(--bone)" fontSize={13} noWrap>
                                            {p.username || shortAddr(p.address)}
                                        </Typography>
                                    </Box>
                                    {/* share is a fraction of 2^32 on-chain; shown as the percentage it means. */}
                                    <Typography textAlign="right" color="var(--text-muted)" fontSize={12} fontFamily="var(--font-data)">
                                        {((p.share / 4294967296) * 100).toFixed(2)}%
                                    </Typography>
                                    <Typography textAlign="right" color="var(--up)" fontSize={13} fontWeight={600} fontFamily="var(--font-data)">
                                        {priceFormatter(weiToBnb(p.amountWei), 8)}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
            </Collapse>
        </Box>
    )
}

export default function Payouts() {
    const { stats, isLoading: statsLoading } = usePayoutStats()
    const { rounds, isLoading } = usePayoutRounds(50)
    const bnbUsd = useBnbUsd()
    const { chains } = useMainContext()
    const { address, isConnected } = useAppKitAccount()
    const { payouts: mine } = useAddressPayouts(isConnected ? address : undefined)

    // Payouts are BSC-only today (no Distributor is deployed on Robinhood), so
    // the explorer link is that chain's.
    const explorerUrl = chains?.find(c => c.network === 'bsc')?.explorerUrl ?? chains?.[0]?.explorerUrl

    const totalPaid = weiToBnb(stats?.totalPaidWei)
    const largest = weiToBnb(stats?.largestPayoutWei)
    const myTotal = weiToBnb(mine?.totalWei)

    return (
        <PageBox pt={6} maxWidth="980px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <PaidIcon sx={{ fontSize: 26 }} /> Payouts
                </Typography>
                <Typography fontSize={13} color="var(--muted)">
                    Every weekly payout this platform has made, on-chain and checkable. 30% of every
                    trading fee goes back to traders — this is the record of it actually happening.
                </Typography>
            </Box>

            <ClaimableBanner />

            <Box display="flex" flexWrap="wrap" gap={2} mb={3}>
                <StatCard
                    label="Paid back to traders"
                    value={statsLoading && !stats ? '—' : `${priceFormatter(totalPaid, 4)} BNB`}
                    sub={bnbUsd != null && totalPaid > 0 ? `≈ $${priceFormatter(totalPaid * bnbUsd, 2)} all time` : 'All time'}
                />
                <StatCard
                    label="Rounds settled"
                    value={statsLoading && !stats ? '—' : String(stats?.roundsSettled ?? 0)}
                    sub="One every week"
                />
                <StatCard
                    label="Traders paid"
                    value={statsLoading && !stats ? '—' : String(stats?.uniqueRecipients ?? 0)}
                    sub={largest > 0 ? `Largest single payout ${priceFormatter(largest, 6)} BNB` : undefined}
                />
            </Box>

            {/* A connected wallet's own total, so the page answers "what about me?"
                without making them scan the rounds for their address. */}
            {isConnected && mine && mine.roundsPaid > 0 && (
                <Box
                    sx={{
                        borderRadius: '16px',
                        p: { xs: 2.5, sm: 3 },
                        mb: 3,
                        border: '1px solid rgba(191,209,67,0.35)',
                        background: 'rgba(191,209,67,0.09)',
                    }}
                >
                    <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">
                        You&apos;ve been paid
                    </Typography>
                    <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap">
                        <Typography fontSize={{ xs: 24, sm: 30 }} fontWeight={800} color="var(--citron)" fontFamily="var(--font-data)">
                            {priceFormatter(myTotal, 6)} BNB
                        </Typography>
                        {bnbUsd != null && (
                            <Typography fontSize={16} fontWeight={600} color="var(--text-muted)" fontFamily="var(--font-data)">
                                ≈ ${priceFormatter(myTotal * bnbUsd, 2)}
                            </Typography>
                        )}
                    </Box>
                    <Typography fontSize={12} color="rgba(234,230,218,0.6)" mt={0.25}>
                        Across {mine.roundsPaid} round{mine.roundsPaid === 1 ? '' : 's'}, sent straight to your wallet
                    </Typography>
                </Box>
            )}

            {isLoading && !rounds ? (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
            ) : !rounds?.length ? (
                <Box py={6} textAlign="center">
                    <Typography color="var(--text-muted)">No rounds have settled yet.</Typography>
                    <Typography color="var(--text-muted)" fontSize={13} mt={0.5}>
                        The first payout lands at the end of the current week. Trade to earn a share of it.
                    </Typography>
                </Box>
            ) : (
                <Box sx={{ border: '1px solid var(--border)', borderRadius: '16px', overflow: 'hidden' }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr auto', sm: '80px 1fr 140px 120px 40px' }, gap: 1, px: 2, py: 1.5, background: 'rgba(234,230,218,0.03)', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-data)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        <Box>Round</Box>
                        <Box display={{ xs: 'none', sm: 'block' }}>Window</Box>
                        <Box textAlign="right">Paid out</Box>
                        <Box display={{ xs: 'none', sm: 'block' }} textAlign="right">Random winner</Box>
                        <Box display={{ xs: 'none', sm: 'block' }} />
                    </Box>
                    {rounds.map(r => (
                        <RoundRow key={r.roundId} round={r} explorerUrl={explorerUrl} bnbUsd={bnbUsd} />
                    ))}
                </Box>
            )}
        </PageBox>
    )
}
