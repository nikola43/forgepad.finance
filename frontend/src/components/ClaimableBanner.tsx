'use client'

import { useCallback, useState } from "react"
import { Box, Button, CircularProgress, Typography } from "@mui/material"
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined'
import { BrowserProvider, ethers } from "ethers"
import toast from "react-hot-toast"
import { useAppKitAccount, useAppKitProvider, type Provider as EVMProvider } from "@reown/appkit/react"
import { priceFormatter } from "@/utils/price"
import { useMainContext } from "@/context"
import { useBnbUsd, useClaimable, weiToBnb } from "@/hooks/payouts"

// ---------------------------------------------------------------------------
// Unclaimed payout balance.
//
// When the Distributor cannot push a payout — a contract wallet, a receiver that
// reverts, a gas-starved fallback — it books the amount to `claimable[address]`
// instead of losing it, and there it stays until the owner calls `claim()`.
// Nothing in the product ever told anyone this money existed; the only way to
// find it was to read contract storage. This banner is that notification.
//
// The wallet signs the claim itself. The backend only ever reads the balance —
// it holds no key that could move these funds.
// ---------------------------------------------------------------------------

const DISTRIBUTOR_CLAIM_ABI = ['function claim()']

export default function ClaimableBanner() {
    const { address, isConnected } = useAppKitAccount()
    const { claimableWei, distributorAddress, reload } = useClaimable(isConnected ? address : undefined)
    const { walletProvider: evmProvider } = useAppKitProvider<EVMProvider>("eip155")
    const { chains } = useMainContext()
    const bnbUsd = useBnbUsd()
    const [claiming, setClaiming] = useState(false)

    const bnb = weiToBnb(claimableWei)

    const claim = useCallback(async () => {
        if (!evmProvider || !distributorAddress) return
        setClaiming(true)
        try {
            const provider = new BrowserProvider(evmProvider)
            const signer = await provider.getSigner()
            const contract = new ethers.Contract(distributorAddress, DISTRIBUTOR_CLAIM_ABI, signer)
            const tx = await contract.claim()
            // Wait on the read RPC rather than the wallet provider, which can
            // throw while polling for the receipt (same approach as the trade
            // flow in views/Token.tsx).
            const rpcUrl = chains?.find(c => c.network === 'bsc')?.rpcUrl ?? chains?.[0]?.rpcUrl
            if (tx?.hash && rpcUrl) {
                await new ethers.JsonRpcProvider(rpcUrl).waitForTransaction(tx.hash).catch(() => { })
            } else {
                await tx?.wait?.().catch(() => { })
            }
            toast.success('Claimed — the BNB is on its way to your wallet')
            reload()
        } catch (error: any) {
            toast.error(error?.shortMessage || error?.data?.message || 'Claim failed')
        } finally {
            setClaiming(false)
        }
    }, [evmProvider, distributorAddress, chains, reload])

    // Hidden unless there is genuinely something to claim. `claimableWei` is null
    // when the read failed, and silence beats telling someone they are owed
    // nothing on the strength of a failed RPC call.
    if (!isConnected || !claimableWei || bnb <= 0 || !distributorAddress) return null

    return (
        <Box
            sx={{
                borderRadius: '16px',
                p: { xs: 2, sm: 2.5 },
                mb: 3,
                border: '1px solid rgba(191,209,67,0.45)',
                background: 'rgba(191,209,67,0.12)',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
            }}
        >
            <SavingsOutlinedIcon sx={{ fontSize: 32, color: 'var(--citron)', flexShrink: 0 }} />
            <Box minWidth={0} flex="1 1 240px">
                <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" letterSpacing="0.05em" fontFamily="var(--font-data)">
                    Unclaimed rewards
                </Typography>
                <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap">
                    <Typography fontSize={{ xs: 20, sm: 24 }} fontWeight={800} color="var(--citron)" fontFamily="var(--font-data)">
                        {priceFormatter(bnb, 8)} BNB
                    </Typography>
                    {bnbUsd != null && (
                        <Typography fontSize={14} fontWeight={600} color="var(--text-muted)" fontFamily="var(--font-data)">
                            ≈ ${priceFormatter(bnb * bnbUsd, 2)}
                        </Typography>
                    )}
                </Box>
                <Typography fontSize={12} color="rgba(234,230,218,0.65)" mt={0.25}>
                    A payout to your wallet couldn&apos;t be delivered, so the contract is holding it for you.
                </Typography>
            </Box>
            <Button
                onClick={claim}
                disabled={claiming}
                sx={{
                    background: 'var(--citron)',
                    color: '#131208',
                    fontWeight: 700,
                    px: 3,
                    py: 1,
                    borderRadius: '10px',
                    textTransform: 'none',
                    '&:hover': { background: 'var(--citron)', opacity: 0.9 },
                    '&.Mui-disabled': { background: 'rgba(191,209,67,0.4)', color: '#131208' },
                }}
            >
                {claiming ? <CircularProgress size={20} sx={{ color: '#131208' }} /> : 'Claim'}
            </Button>
        </Box>
    )
}
