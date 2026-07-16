'use client'

import { Box, Typography } from "@mui/material"
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech'
import PageBox from "@/components/layout/pageBox"
import TraderTierBadge from "@/components/TraderTierBadge"
import { useAppKitAccount } from "@reown/appkit/react"

const TIERS = [
    { name: 'Bronze', threshold: '$0+', color: '#E6A15A' },
    { name: 'Silver', threshold: '$100+', color: '#CBD5E1' },
    { name: 'Gold', threshold: '$1,000+', color: '#F5D061' },
    { name: 'Diamond', threshold: '$10,000+', color: '#67E8F9' },
]

export default function Tier() {
    const { address, isConnected } = useAppKitAccount()

    return (
        <PageBox pt={6} maxWidth="720px" mx="auto" width="100%">
            <Box mb={2}>
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <MilitaryTechIcon sx={{ fontSize: 26 }} /> Trader Tier
                </Typography>
                <Typography fontSize={13} color="var(--muted)">
                    Your tier is based on your lifetime trading volume on Fyuz. Trade more to climb the ranks.
                </Typography>
            </Box>

            {!isConnected ? (
                <Typography color="var(--text-muted)" py={6} textAlign="center">Connect your wallet to see your trader tier.</Typography>
            ) : (
                <Box mb={3}>
                    <TraderTierBadge address={address} />
                </Box>
            )}

            <Typography color="var(--bone)" fontSize={18} fontWeight={700} fontFamily="var(--font-display)" mb={1.5}>Tiers &amp; Thresholds</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr' }, gap: 1.5 }}>
                {TIERS.map((t) => (
                    <Box
                        key={t.name}
                        sx={{ p: 2, borderRadius: '12px', textAlign: 'center', border: '1px solid var(--border)', background: 'rgba(234,230,218,0.03)' }}
                    >
                        <Typography fontSize={15} fontWeight={800} color={t.color} textTransform="uppercase" letterSpacing="0.04em">{t.name}</Typography>
                        <Typography fontSize={13} color="var(--muted)" mt={0.5} fontFamily="var(--font-data)">{t.threshold}</Typography>
                    </Box>
                ))}
            </Box>
        </PageBox>
    )
}
