'use client'

import { useState } from "react"
import { Avatar, Box, Button, TextField, Typography } from "@mui/material"
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import toast from "react-hot-toast"
import { usePaper } from "@/hooks/paper"
import { useDiscover } from "@/hooks/discover"

const pnlColor = (v: number) => (v > 0 ? '#10B981' : v < 0 ? '#EF4444' : '#94A3B8')
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${priceFormatter(Math.abs(v), 4)}`

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <Box sx={{ flex: 1, minWidth: 130, p: 2, borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
            <Typography fontSize={20} fontWeight={800} color={color || 'white'} fontFamily="'Space Grotesk', sans-serif">{value}</Typography>
            <Typography fontSize={11} color="#94A3B8" textTransform="uppercase">{label}</Typography>
        </Box>
    )
}

export default function Simulator() {
    const { address } = useAppKitAccount()
    const { paper, buy, sell, reset } = usePaper(address)
    const { tokens: trending } = useDiscover({ tab: 'trending', limit: 12 })
    const [amounts, setAmounts] = useState<Record<string, string>>({})
    const [pending, setPending] = useState<string | null>(null)

    const doBuy = async (tokenAddress: string) => {
        const amt = parseFloat(amounts[tokenAddress] || '0.1')
        if (!(amt > 0)) { toast.error('Enter an amount'); return }
        setPending(tokenAddress)
        try { await buy(tokenAddress, amt); toast.success('Simulated buy filled') }
        catch (e: any) { toast.error(e?.response?.data?.error || 'Buy failed') }
        finally { setPending(null) }
    }
    const doSell = async (tokenAddress: string, percent: number) => {
        setPending(tokenAddress)
        try { await sell(tokenAddress, percent); toast.success('Simulated sell filled') }
        catch (e: any) { toast.error(e?.response?.data?.error || 'Sell failed') }
        finally { setPending(null) }
    }

    return (
        <PageBox pt={6} maxWidth="1000px" mx="auto" width="100%">
            <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1}>
                <Box>
                    <Typography fontSize={26} fontWeight={800} color="white" fontFamily="'Space Grotesk', sans-serif">Practice Mode</Typography>
                    <Typography fontSize={13} color="#94A3B8">Risk-free paper trading on the real bonding curve — no ETH, no chain tx.</Typography>
                </Box>
                <Box sx={{ px: 1.5, py: 0.5, borderRadius: '8px', border: '1px solid rgba(234,179,8,0.4)', background: 'rgba(234,179,8,0.08)' }}>
                    <Typography fontSize={12} color="#EAB308" fontWeight={700}>● SIMULATED</Typography>
                </Box>
            </Box>

            {!address ? (
                <Typography color="#64748B" py={6} textAlign="center">Connect a wallet to start practicing.</Typography>
            ) : (
                <>
                    <Box display="flex" gap={1.5} flexWrap="wrap" my={2}>
                        <Stat label="Virtual Balance" value={`${priceFormatter(paper?.ethBalance ?? 0, 4)} ETH`} />
                        <Stat label="Total Value" value={`${priceFormatter(paper?.totalValueEth ?? 0, 4)} ETH`} />
                        <Stat label="Total PnL" value={`${signed(paper?.totalPnlEth ?? 0)} ETH`} color={pnlColor(paper?.totalPnlEth ?? 0)} />
                        <Stat label="Return" value={`${(paper?.totalPnlPct ?? 0) > 0 ? '+' : ''}${priceFormatter(paper?.totalPnlPct ?? 0, 2)}%`} color={pnlColor(paper?.totalPnlPct ?? 0)} />
                    </Box>
                    <Box textAlign="right" mb={3}>
                        <Button onClick={() => reset().then(() => toast.success('Reset to 10 ETH'))} sx={{ textTransform: 'none', color: '#94A3B8', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', px: 2, fontSize: 13 }}>
                            Reset account
                        </Button>
                    </Box>

                    {!!paper?.positions?.length && (
                        <Box mb={4}>
                            <Typography fontSize={16} fontWeight={700} color="white" mb={1.5}>Your positions</Typography>
                            <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', overflow: 'hidden' }}>
                                {paper.positions.map((p, i) => (
                                    <Box key={p.tokenAddress} display="flex" alignItems="center" gap={1.5} px={2} py={1.5} sx={{ borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none', flexWrap: 'wrap' }}>
                                        <Avatar src={p.image || undefined} sx={{ width: 34, height: 34 }} />
                                        <Box flex={1} minWidth={120}>
                                            <Typography color="white" fontSize={14} fontWeight={600}>{p.symbol}</Typography>
                                            <Typography color="#64748B" fontSize={11}>{priceFormatter(p.tokenAmount, 2)} tokens</Typography>
                                        </Box>
                                        <Box textAlign="right" minWidth={110}>
                                            <Typography color="white" fontSize={13}>{priceFormatter(p.currentValueEth, 4)} ETH</Typography>
                                            <Typography fontSize={11} color={pnlColor(p.unrealizedPnlEth)}>{signed(p.unrealizedPnlEth)} ({priceFormatter(p.roiPct, 1)}%)</Typography>
                                        </Box>
                                        <Box display="flex" gap={0.5}>
                                            {[0.25, 0.5, 1].map(pct => (
                                                <Button key={pct} onClick={() => doSell(p.tokenAddress, pct)} disabled={pending === p.tokenAddress || p.tokenAmount <= 0}
                                                    sx={{ minWidth: 0, px: 1, fontSize: 11, textTransform: 'none', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px' }}>
                                                    {pct === 1 ? 'All' : `${pct * 100}%`}
                                                </Button>
                                            ))}
                                        </Box>
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    )}

                    <Typography fontSize={16} fontWeight={700} color="white" mb={1.5}>Practice with trending tokens</Typography>
                    <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', overflow: 'hidden' }}>
                        {trending.length === 0 && <Typography color="#64748B" p={2} fontSize={13}>No tokens available.</Typography>}
                        {trending.map((t, i) => (
                            <Box key={t.tokenAddress} display="flex" alignItems="center" gap={1.5} px={2} py={1.5} sx={{ borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none', flexWrap: 'wrap' }}>
                                <Avatar src={t.image || undefined} sx={{ width: 34, height: 34 }} />
                                <Box flex={1} minWidth={120}>
                                    <Typography color="white" fontSize={14} fontWeight={600}>{t.symbol}</Typography>
                                    <Typography color="#64748B" fontSize={11}>${priceFormatter(t.marketcap, 0)} mcap</Typography>
                                </Box>
                                <TextField
                                    size="small" placeholder="0.1" value={amounts[t.tokenAddress] ?? ''}
                                    onChange={e => setAmounts(a => ({ ...a, [t.tokenAddress]: e.target.value.replace(/[^0-9.]/g, '') }))}
                                    sx={{ width: 90, '& .MuiInputBase-input': { color: 'white', fontSize: 13, py: 0.75 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' } }}
                                    InputProps={{ endAdornment: <Typography fontSize={11} color="#64748B">ETH</Typography> }}
                                />
                                <Button onClick={() => doBuy(t.tokenAddress)} disabled={pending === t.tokenAddress}
                                    sx={{ textTransform: 'none', background: '#22C55E', color: '#04120A', fontWeight: 700, borderRadius: '10px', px: 2, '&:hover': { background: '#16A34A' } }}>
                                    Buy
                                </Button>
                            </Box>
                        ))}
                    </Box>
                    {!!paper?.ethPriceUsd && <Typography fontSize={11} color="#475569" mt={2} textAlign="center">1 ETH ≈ ${priceFormatter(paper.ethPriceUsd, 2)}</Typography>}
                </>
            )}
        </PageBox>
    )
}
