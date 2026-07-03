'use client'

import { Box, CircularProgress, Typography } from "@mui/material"
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
                border: accent ? '1px solid rgba(139,92,246,0.30)' : '1px solid rgba(255,255,255,0.08)',
                background: accent
                    ? 'linear-gradient(135deg, rgba(139,92,246,0.14), rgba(139,92,246,0.02))'
                    : 'rgba(255,255,255,0.03)',
            }}
        >
            <Typography fontSize={26} fontWeight={800} color={accent ? '#c4b5fd' : '#e4ff66'}>{value}</Typography>
            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase" letterSpacing="0.05em">{label}</Typography>
        </Box>
    )
}

export default function Airdrop() {
    const { address, isConnected } = useAppKitAccount()
    const { airdrop } = useAirdrop(address)

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">🪂 Airdrop</Typography>
                <Typography fontSize={13} color="#94A3B8">
                    Your accrued points set your indicative weight in a hypothetical future token distribution. Keep trading, completing quests and holding your streak to grow your share.
                </Typography>
            </Box>

            {!isConnected ? (
                <Typography color="#64748B" py={6} textAlign="center">Connect your wallet to see your projected airdrop allocation.</Typography>
            ) : !airdrop ? (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress sx={{ color: '#D3FF24' }} /></Box>
            ) : (
                <>
                    {/* Projected share hero */}
                    <Box
                        sx={{
                            p: 3,
                            mb: 3,
                            borderRadius: '16px',
                            border: '1px solid rgba(139,92,246,0.30)',
                            background: 'linear-gradient(135deg, rgba(139,92,246,0.16), rgba(139,92,246,0.02))',
                            textAlign: 'center',
                        }}
                    >
                        <Typography fontSize={12} color="#c4b5fd" textTransform="uppercase" letterSpacing="0.08em">Your projected share</Typography>
                        <Typography fontSize={48} fontWeight={800} color="#fff" lineHeight={1.1} mt={0.5}>
                            {priceFormatter(airdrop.sharePct, 4)}%
                        </Typography>
                        <Typography fontSize={13} color="rgba(255,255,255,0.7)" mt={0.5}>
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
                            border: '1px solid rgba(255,255,255,0.08)',
                            background: 'rgba(255,255,255,0.02)',
                        }}
                    >
                        <Typography fontSize={12.5} color="#94A3B8" lineHeight={1.55}>
                            ⚠️ Allocation is indicative only. These figures are an estimate of relative weight from current points and do not represent a promise, guarantee or reservation of any token. There is no confirmed airdrop, amount, eligibility or date. Points, weights and any future distribution rules may change at any time.
                        </Typography>
                    </Box>
                </>
            )}
        </PageBox>
    )
}
