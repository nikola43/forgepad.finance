'use client'

import { useState } from "react"
import { Avatar, Box, Button, TextField, Typography } from "@mui/material"
import PageBox from "@/components/layout/pageBox"
import { priceFormatter } from "@/utils/price"
import { useAppKitAccount } from "@reown/appkit/react"
import toast from "react-hot-toast"
import { usePaper } from "@/hooks/paper"
import { useDiscover } from "@/hooks/discover"

const pnlColor = (v: number) => (v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--muted)')
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${priceFormatter(Math.abs(v), 4)}`

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <Box sx={{ flex: 1, minWidth: 130, p: 2, borderRadius: '14px', border: '1px solid var(--border)', background: 'rgba(234,230,218,0.03)' }}>
            <Typography fontSize={20} fontWeight={800} color={color || 'var(--bone)'} fontFamily="var(--font-data)">{value}</Typography>
            <Typography fontSize={11} color="var(--muted)" textTransform="uppercase" fontFamily="var(--font-data)">{label}</Typography>
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
                    <Typography fontSize={26} fontWeight={800} color="var(--bone)" fontFamily="var(--font-display)">Practice Mode</Typography>
                    <Typography fontSize={13} color="var(--muted)">Risk-free paper trading on the real bonding curve — no BNB, no chain tx.</Typography>
                </Box>
                <Box sx={{ px: 1.5, py: 0.5, borderRadius: '8px', border: '1px solid rgba(232,185,59,0.4)', background: 'rgba(232,185,59,0.08)' }}>
                    <Typography fontSize={12} color="var(--warning)" fontWeight={700} fontFamily="var(--font-data)">● SIMULATED</Typography>
                </Box>
            </Box>

            {!address ? (
                <Typography color="var(--text-muted)" py={6} textAlign="center">Connect a wallet to start practicing.</Typography>
            ) : (
                <>
                    <Box display="flex" gap={1.5} flexWrap="wrap" my={2}>
                        <Stat label="Virtual Balance" value={`${priceFormatter(paper?.ethBalance ?? 0, 4)} BNB`} />
                        <Stat label="Total Value" value={`${priceFormatter(paper?.totalValueEth ?? 0, 4)} BNB`} />
                        <Stat label="Total PnL" value={`${signed(paper?.totalPnlEth ?? 0)} BNB`} color={pnlColor(paper?.totalPnlEth ?? 0)} />
                        <Stat label="Return" value={`${(paper?.totalPnlPct ?? 0) > 0 ? '+' : ''}${priceFormatter(paper?.totalPnlPct ?? 0, 2)}%`} color={pnlColor(paper?.totalPnlPct ?? 0)} />
                    </Box>
                    <Box textAlign="right" mb={3}>
                        <Button onClick={() => reset().then(() => toast.success('Reset to 10 BNB'))} sx={{ textTransform: 'none', color: 'var(--muted)', border: '1px solid rgba(234,230,218,0.12)', borderRadius: '10px', px: 2, fontSize: 13 }}>
                            Reset account
                        </Button>
                    </Box>

                    {!!paper?.positions?.length && (
                        <Box mb={4}>
                            <Typography fontSize={16} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" mb={1.5}>Your positions</Typography>
                            <Box sx={{ border: '1px solid var(--border)', borderRadius: '14px', overflow: 'hidden' }}>
                                {paper.positions.map((p, i) => (
                                    <Box key={p.tokenAddress} display="flex" alignItems="center" gap={1.5} px={2} py={1.5} sx={{ borderTop: i ? '1px solid rgba(234,230,218,0.05)' : 'none', flexWrap: 'wrap' }}>
                                        <Avatar src={p.image || undefined} sx={{ width: 34, height: 34 }} />
                                        <Box flex={1} minWidth={120}>
                                            <Typography color="var(--bone)" fontSize={14} fontWeight={600} fontFamily="var(--font-data)">{p.symbol}</Typography>
                                            <Typography color="var(--text-muted)" fontSize={11} fontFamily="var(--font-data)">{priceFormatter(p.tokenAmount, 2)} tokens</Typography>
                                        </Box>
                                        <Box textAlign="right" minWidth={110}>
                                            <Typography color="var(--bone)" fontSize={13} fontFamily="var(--font-data)">{priceFormatter(p.currentValueEth, 4)} BNB</Typography>
                                            <Typography fontSize={11} color={pnlColor(p.unrealizedPnlEth)} fontFamily="var(--font-data)">{signed(p.unrealizedPnlEth)} ({priceFormatter(p.roiPct, 1)}%)</Typography>
                                        </Box>
                                        <Box display="flex" gap={0.5}>
                                            {[0.25, 0.5, 1].map(pct => (
                                                <Button key={pct} onClick={() => doSell(p.tokenAddress, pct)} disabled={pending === p.tokenAddress || p.tokenAmount <= 0}
                                                    sx={{ minWidth: 0, px: 1, fontSize: 11, textTransform: 'none', color: 'var(--down)', border: '1px solid rgba(214,69,69,0.3)', borderRadius: '8px' }}>
                                                    {pct === 1 ? 'All' : `${pct * 100}%`}
                                                </Button>
                                            ))}
                                        </Box>
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    )}

                    <Typography fontSize={16} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" mb={1.5}>Practice with trending tokens</Typography>
                    <Box sx={{ border: '1px solid var(--border)', borderRadius: '14px', overflow: 'hidden' }}>
                        {trending.length === 0 && <Typography color="var(--text-muted)" p={2} fontSize={13}>No tokens available.</Typography>}
                        {trending.map((t, i) => (
                            <Box key={t.tokenAddress} display="flex" alignItems="center" gap={1.5} px={2} py={1.5} sx={{ borderTop: i ? '1px solid rgba(234,230,218,0.05)' : 'none', flexWrap: 'wrap' }}>
                                <Avatar src={t.image || undefined} sx={{ width: 34, height: 34 }} />
                                <Box flex={1} minWidth={120}>
                                    <Typography color="var(--bone)" fontSize={14} fontWeight={600} fontFamily="var(--font-data)">{t.symbol}</Typography>
                                    <Typography color="var(--text-muted)" fontSize={11} fontFamily="var(--font-data)">${priceFormatter(t.marketcap, 0)} mcap</Typography>
                                </Box>
                                <TextField
                                    size="small" placeholder="0.1" value={amounts[t.tokenAddress] ?? ''}
                                    onChange={e => setAmounts(a => ({ ...a, [t.tokenAddress]: e.target.value.replace(/[^0-9.]/g, '') }))}
                                    sx={{ width: 90, '& .MuiInputBase-input': { color: 'var(--bone)', fontFamily: 'var(--font-data)', fontSize: 13, py: 0.75 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(234,230,218,0.15)' } }}
                                    InputProps={{ endAdornment: <Typography fontSize={11} color="var(--text-muted)" fontFamily="var(--font-data)">BNB</Typography> }}
                                />
                                <Button onClick={() => doBuy(t.tokenAddress)} disabled={pending === t.tokenAddress}
                                    sx={{ textTransform: 'none', background: 'var(--up)', color: 'var(--moss-black)', fontWeight: 700, borderRadius: '10px', px: 2, '&:hover': { background: 'var(--up)' } }}>
                                    Buy
                                </Button>
                            </Box>
                        ))}
                    </Box>
                    {!!paper?.ethPriceUsd && <Typography fontSize={11} color="var(--text-muted)" fontFamily="var(--font-data)" mt={2} textAlign="center">1 BNB ≈ ${priceFormatter(paper.ethPriceUsd, 2)}</Typography>}
                </>
            )}
        </PageBox>
    )
}
