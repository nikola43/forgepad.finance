'use client'

import { Box, CircularProgress, Typography } from "@mui/material"
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import { useAirdrop } from "@/hooks/airdrop"

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <Box
            sx={{
                flex: 1,
                minWidth: 150,
                p: 2,
                borderRadius: '14px',
                border: accent ? '1px solid rgba(199,75,142,0.30)' : '1px solid var(--border)',
                background: accent ? 'rgba(199,75,142,0.06)' : 'rgba(234,230,218,0.03)',
            }}
        >
            <Typography fontSize={26} fontWeight={800} fontFamily="var(--font-data)" color={accent ? 'var(--plum-rose)' : 'var(--citron)'}>{value}</Typography>
            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">{label}</Typography>
        </Box>
    )
}

export default function Airdrop() {
    const { address, isConnected } = useAppKitAccount()
    const { airdrop } = useAirdrop(address)

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <CardGiftcardIcon sx={{ fontSize: 26 }} /> Airdrop
                </Typography>
                <Typography fontSize={13} color="var(--muted)">
                    Your accrued points set your indicative weight in a hypothetical future token distribution. Keep trading, completing quests and holding your streak to grow your share.
                </Typography>
            </Box>

            {!isConnected ? (
                <Typography color="var(--text-muted)" py={6} textAlign="center">Connect your wallet to see your projected airdrop allocation.</Typography>
            ) : !airdrop ? (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress sx={{ color: 'var(--citron)' }} /></Box>
            ) : (
                <>
                    {/* Projected share hero */}
                    <Box
                        sx={{
                            p: 3,
                            mb: 3,
                            borderRadius: '16px',
                            border: '1px solid rgba(199,75,142,0.30)',
                            background: 'rgba(199,75,142,0.08)',
                            textAlign: 'center',
                        }}
                    >
                        <Typography fontSize={12} color="var(--muted)" textTransform="uppercase" letterSpacing="0.08em" fontFamily="var(--font-data)">Your projected share</Typography>
                        <Typography fontSize={48} fontWeight={800} color="var(--bone)" fontFamily="var(--font-data)" lineHeight={1.1} mt={0.5}>
                            {priceFormatter(airdrop.sharePct, 4)}%
                        </Typography>
                        <Typography fontSize={13} color="rgba(234,230,218,0.7)" mt={0.5}>
                            of a hypothetical airdrop pool, based on {priceFormatter(airdrop.yourPoints, 2)} of {priceFormatter(airdrop.totalPoints, 2)} network points.
                        </Typography>
                    </Box>

                    {/* Stat grid */}
                    <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
                        <StatCard label="Your points" value={priceFormatter(airdrop.yourPoints, 2)} accent />
                        <StatCard label="Your rank" value={airdrop.rank > 0 ? `#${airdrop.rank}` : '—'} />
                        <StatCard label="Total users" value={priceFormatter(airdrop.totalUsers, 0)} />
                        <StatCard label="Network points" value={priceFormatter(airdrop.totalPoints, 0)} />
                    </Box>

                    {/* Disclaimer */}
                    <Box
                        sx={{
                            p: 2,
                            borderRadius: '12px',
                            border: '1px solid var(--border)',
                            background: 'rgba(234,230,218,0.02)',
                        }}
                    >
                        <Typography fontSize={12.5} color="var(--muted)" lineHeight={1.55} display="flex" alignItems="flex-start" gap={0.75}>
                            <WarningAmberIcon sx={{ fontSize: 16, color: 'var(--warning)', flexShrink: 0, mt: '1px' }} />
                            Allocation is indicative only. These figures are an estimate of relative weight from current points and do not represent a promise, guarantee or reservation of any token. There is no confirmed airdrop, amount, eligibility or date. Points, weights and any future distribution rules may change at any time.
                        </Typography>
                    </Box>
                </>
            )}
        </PageBox>
    )
}
