'use client'

import { Box, Typography } from "@mui/material"
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import Link from "next/link"
import useSWR from "swr"
import { ethers } from "ethers"
import PageBox from "@/components/layout/pageBox"
import ChainlinkMark from "@/components/brand/ChainlinkMark"
import { useMainContext } from "@/context"
import { CREATOR_FEE_PROMO, FEES, isCreatorFeePromoLive } from "@/config"

// The commercials page. Copy is written inline on purpose — it is marketing
// prose, not product state, and is meant to be rewritten without touching the
// numbers. The NUMBERS are read live from the Fyuz contract below and fall back
// to @/config FEES only when the RPC is unreachable, so nothing here can drift
// from what the contract actually charges.

// Read straight from the contract rather than the shipped ABI: these getters
// are what the fee page is about, and a couple of them (minCreateBuyUSD,
// platformTreasuryShareBps) post-date the ABI the backend serves.
const FEE_ABI = [
    'function PLATFORM_BUY_FEE_BPS() view returns (uint256)',
    'function PLATFORM_SELL_FEE_BPS() view returns (uint256)',
    'function TOKEN_OWNER_FEE_BPS() view returns (uint256)',
    'function platformTreasuryShareBps() view returns (uint256)',
    'function CREATE_TOKEN_FEE_AMOUNT() view returns (uint256)',
    'function platformLPFee() view returns (uint256)',
    'function tokenOwnerLPFee() view returns (uint256)',
    'function minCreateBuyUSD() view returns (uint256)',
    'function TARGET_MARKET_CAP_USD() view returns (uint256)',
]

type LiveFees = {
    platformBps: number
    platformSellBps: number
    creatorBps: number
    treasuryBps: number
    seasonPotBps: number
    createFeeBnb: number
    graduationFeeBnb: number
    creatorGraduationBnb: number
    minInitialBuyUsd: number
    graduationMcapUsd: number
}

function useLiveFees() {
    const { chains } = useMainContext()
    // BSC is the commercial chain; anything else is a testnet or a preview.
    const chain = chains?.find((c) => c.network === 'bsc') ?? chains?.[0]

    const { data: live } = useSWR<LiveFees | undefined>(
        chain ? ['/fees/live', chain.contractAddress, chain.rpcUrl] : null,
        async () => {
            const provider = new ethers.JsonRpcProvider(chain!.rpcUrl)
            const fyuz = new ethers.Contract(chain!.contractAddress, FEE_ABI, provider)
            // Each getter is caught on its own: an older proxy missing one of
            // them must degrade to the config default, not blank the page.
            const read = async (fn: string) => {
                try { return (await fyuz[fn]()) as bigint } catch { return undefined }
            }
            const [buy, sell, creator, treasuryShare, createFee, lpFee, ownerLpFee, minBuy, mcap] =
                await Promise.all([
                    read('PLATFORM_BUY_FEE_BPS'), read('PLATFORM_SELL_FEE_BPS'),
                    read('TOKEN_OWNER_FEE_BPS'), read('platformTreasuryShareBps'),
                    read('CREATE_TOKEN_FEE_AMOUNT'), read('platformLPFee'),
                    read('tokenOwnerLPFee'), read('minCreateBuyUSD'),
                    read('TARGET_MARKET_CAP_USD'),
                ])

            const platformBps = buy !== undefined ? Number(buy) : FEES.platformBps
            // The treasury/season-pot split is a share OF the platform fee, so
            // the pot always takes the remainder — same as _payPlatformFee.
            const treasuryBps = treasuryShare !== undefined
                ? (platformBps * Number(treasuryShare)) / 10_000
                : FEES.treasuryBps
            const eth = (v: bigint | undefined, fallback: number) =>
                v !== undefined ? Number(ethers.formatEther(v)) : fallback

            return {
                platformBps,
                platformSellBps: sell !== undefined ? Number(sell) : FEES.platformBps,
                creatorBps: creator !== undefined ? Number(creator) : FEES.creatorBps,
                treasuryBps,
                seasonPotBps: platformBps - treasuryBps,
                createFeeBnb: eth(createFee, FEES.createFeeBnb),
                graduationFeeBnb: eth(lpFee, FEES.graduationFeeBnb),
                creatorGraduationBnb: eth(ownerLpFee, 0),
                minInitialBuyUsd: eth(minBuy, FEES.minInitialBuyUsd),
                graduationMcapUsd: eth(mcap, FEES.graduationMcapUsd),
            }
        },
        { revalidateOnFocus: false, dedupingInterval: 60_000 },
    )

    return { chain, live }
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : bps % 10 === 0 ? 1 : 2)}%`

/** Section shell — heading, optional kicker, bordered body. */
function Section({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
    return (
        <Box mb={3}>
            <Typography fontSize={18} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" mb={kicker ? 0.25 : 1.5}>
                {title}
            </Typography>
            {kicker && <Typography fontSize={13} color="var(--muted)" mb={1.5}>{kicker}</Typography>}
            {children}
        </Box>
    )
}

/** One line of the fee table: what is charged, how much, and who receives it. */
function FeeRow({ label, value, detail, accent, tag }: {
    label: string; value: string; detail: string; accent?: boolean; tag?: string
}) {
    return (
        <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr auto', sm: '180px 1fr auto' },
            alignItems: 'baseline',
            gap: { xs: 0.5, sm: 2 },
            px: 2, py: 1.5,
            borderBottom: '1px solid var(--border)',
            '&:last-of-type': { borderBottom: 'none' },
        }}>
            <Typography fontSize={14} fontWeight={700} color={accent ? 'var(--citron)' : 'var(--bone)'} display="flex" alignItems="center" gap={1}>
                {label}
                {tag && (
                    <Box component="span" sx={{
                        fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700,
                        letterSpacing: '1px', textTransform: 'uppercase',
                        color: 'var(--moss-black)', background: 'var(--citron)',
                        borderRadius: '6px', px: 0.75, py: 0.25,
                    }}>{tag}</Box>
                )}
            </Typography>
            <Typography fontSize={13} color="var(--muted)" sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, order: { xs: 2, sm: 0 } }}>
                {detail}
            </Typography>
            <Typography fontSize={15} fontWeight={800} fontFamily="var(--font-data)" color={accent ? 'var(--citron)' : 'var(--bone)'} textAlign="right" whiteSpace="nowrap">
                {value}
            </Typography>
        </Box>
    )
}

const Card = ({ children }: { children: React.ReactNode }) => (
    <Box sx={{ borderRadius: '14px', border: '1px solid var(--border)', background: 'rgba(234,230,218,0.02)' }}>
        {children}
    </Box>
)

export default function Fees() {
    const { chain, live } = useLiveFees()

    const platformBps = live?.platformBps ?? FEES.platformBps
    const treasuryBps = live?.treasuryBps ?? FEES.treasuryBps
    const seasonPotBps = live?.seasonPotBps ?? FEES.seasonPotBps
    const creatorBps = live?.creatorBps ?? FEES.creatorBps
    const totalBps = platformBps + creatorBps
    // This page never advertises ahead of the chain, whatever the banner is
    // doing: the promo card and the badge on the creator row both wait for the
    // contract to actually be charging the promotional rate, so the card can
    // never claim a rate the table below it contradicts.
    const promoOnChain = creatorBps >= CREATOR_FEE_PROMO.bps
    const promoLive = isCreatorFeePromoLive() && promoOnChain

    const createFeeBnb = live?.createFeeBnb ?? FEES.createFeeBnb
    // The floor exists in two places: the contract's minCreateBuyUSD and the
    // create form. The contract's wins when set; when it is 0 the form is still
    // enforcing the published minimum, which is what a creator actually meets.
    const minInitialBuyUsd = live?.minInitialBuyUsd || FEES.minInitialBuyUsd
    const graduationFeeBnb = live?.graduationFeeBnb ?? FEES.graduationFeeBnb
    const creatorGraduationBnb = live?.creatorGraduationBnb ?? 0
    const graduationMcapUsd = live?.graduationMcapUsd ?? FEES.graduationMcapUsd
    const sellDiffers = live !== undefined && live.platformSellBps !== live.platformBps

    const explorer = chain?.explorerUrl && chain?.contractAddress
        ? `${chain.explorerUrl.replace(/\/$/, '')}/address/${chain.contractAddress}`
        : undefined

    return (
        <PageBox pt={6} maxWidth="900px" mx="auto" width="100%">
            <Box mb={3}>
                <Typography fontSize={28} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" display="flex" alignItems="center" gap={1}>
                    <ReceiptLongOutlinedIcon sx={{ fontSize: 26 }} /> Fees &amp; commercials
                </Typography>
                <Typography fontSize={13} color="var(--muted)">
                    Every charge on Fyuz, in one place. The figures below are read live from the Fyuz contract on BNB Smart Chain — not typed into this page — so what you see here is exactly what the contract charges.
                </Typography>
            </Box>

            {/* Promotion */}
            {promoLive && (
                <Box sx={{
                    mb: 3, p: 2.5, borderRadius: '16px',
                    border: '1px solid var(--citron)', background: 'rgba(191,209,67,0.08)',
                }}>
                    <Typography fontFamily="var(--font-data)" fontSize={11} fontWeight={700} letterSpacing="2px" textTransform="uppercase" color="var(--citron)" mb={0.5}>
                        {CREATOR_FEE_PROMO.eyebrow}
                    </Typography>
                    <Typography fontSize={24} fontWeight={800} fontFamily="var(--font-display)" color="var(--bone)" mb={0.5}>
                        {CREATOR_FEE_PROMO.headline}
                    </Typography>
                    <Typography fontSize={14} color="var(--bone)" sx={{ opacity: 0.85 }}>
                        {CREATOR_FEE_PROMO.body}
                    </Typography>
                    <Typography fontSize={12} color="var(--muted)" mt={1}>
                        {CREATOR_FEE_PROMO.endsAt
                            ? `Runs until ${new Date(CREATOR_FEE_PROMO.endsAt).toLocaleDateString()}. `
                            : 'Runs until further notice. '}
                        The creator fee is set on-chain, so the rate in the table below is always the rate being paid.
                    </Typography>
                </Box>
            )}

            {/* Trading */}
            <Section
                title="Trading on the curve"
                kicker={`${pct(totalBps)} per trade — the only fee Fyuz takes while a token is on its bonding curve. It applies to buys and sells alike, is taken in ${chain?.currency ?? 'BNB'}, and is split three ways at the moment of the trade.`}
            >
                <Card>
                    <FeeRow label="Treasury" value={pct(treasuryBps)} detail="Runs the platform — infrastructure, image generation, listings and marketing." />
                    <FeeRow label="Season pot" value={pct(seasonPotBps)} detail="Funds the weekly leaderboard prize pot, paid back out to traders." />
                    <FeeRow
                        label="Token creator"
                        value={pct(creatorBps)}
                        accent
                        tag={promoOnChain ? `${CREATOR_FEE_PROMO.multiplier}x promo` : undefined}
                        detail="Paid straight to the wallet that launched the token, on every buy and every sell. No claiming, no vesting."
                    />
                    <FeeRow label="Total" value={pct(totalBps)} detail={sellDiffers ? 'Charged on buys; sells are charged separately — see below.' : 'Charged identically on buys and sells.'} />
                </Card>
                {sellDiffers && (
                    <Typography fontSize={12} color="var(--warning)" mt={1}>
                        Sells are currently charged {pct(live!.platformSellBps + creatorBps)} on-chain.
                    </Typography>
                )}
            </Section>

            {/* Launching */}
            <Section title="Launching a token" kicker="What it costs to bring a fusion to market.">
                <Card>
                    <FeeRow label="Creation fee" value={`${createFeeBnb} ${chain?.currency ?? 'BNB'}`} detail="One-off, paid when the token contract is deployed." />
                    {minInitialBuyUsd > 0 && (
                        <FeeRow
                            label="Initial buy"
                            value={`$${minInitialBuyUsd.toLocaleString()} min`}
                            detail="Not a fee — you are buying your own token's first supply and you keep every one of those tokens. Required so no launch arrives with nothing behind it."
                        />
                    )}
                    <FeeRow label="Fyuz's token allocation" value="0%" detail="Fyuz takes no share of any token's supply. The whole supply goes to the curve, the DEX pool, or the burn address." />
                </Card>
            </Section>

            {/* Graduation */}
            <Section
                title="Graduation"
                kicker={`At a $${graduationMcapUsd.toLocaleString()} market cap a token graduates: the curve's liquidity migrates to PancakeSwap automatically, in the same transaction as the trade that tips it over.`}
            >
                <Card>
                    <FeeRow label="Migration fee" value={`${graduationFeeBnb} ${chain?.currency ?? 'BNB'}`} detail="Taken once from the curve's reserve at graduation, to the treasury. Everything else in the reserve goes into the DEX pool." />
                    {creatorGraduationBnb > 0 && (
                        <FeeRow label="Creator's graduation bonus" value={`${creatorGraduationBnb} ${chain?.currency ?? 'BNB'}`} detail="Paid from the same reserve to the token's creator." accent />
                    )}
                    <FeeRow label="LP tokens" value="Burned" detail="The liquidity position is sent to the burn address at graduation — the pool cannot be pulled, by Fyuz or by the creator. Any tokens left on the curve are burned too." />
                </Card>
            </Section>

            {/* Post-graduation */}
            <Section title="After graduation" kicker="Once a token is trading on PancakeSwap, Fyuz is out of the loop.">
                <Card>
                    <FeeRow label="Fyuz's cut of DEX trades" value="0%" detail="The curve fee stops at graduation. PancakeSwap charges its own swap fee, which goes to the pool's liquidity providers, not to Fyuz." />
                    <FeeRow
                        label="Pool fees (V3 launches)"
                        value={`${FEES.creatorLpSharePercent}/${100 - FEES.creatorLpSharePercent}`}
                        detail="Tokens launched into a V3 pool accrue collectable trading fees, split evenly between the creator and the treasury. Creators claim theirs from their profile. V2 pools have no separately collectable fees."
                    />
                </Card>
            </Section>

            {/* Not charged */}
            <Section title="What Fyuz never charges">
                <Card>
                    <Box sx={{ px: 2, py: 1.75, display: 'grid', gap: 1 }}>
                        {[
                            'No fee to hold or transfer a token.',
                            'No listing fee, no application fee, no subscription.',
                            'No deposit or withdrawal fee — Fyuz is non-custodial and never holds your funds.',
                            'No fee on rewards, referral points or leaderboard payouts. What the pot says is what is paid.',
                        ].map((line) => (
                            <Typography key={line} fontSize={14} color="var(--bone)" sx={{ opacity: 0.85 }}>
                                <Box component="span" sx={{ color: 'var(--citron)', mr: 1 }}>—</Box>{line}
                            </Typography>
                        ))}
                    </Box>
                </Card>
            </Section>

            {/* Chainlink */}
            <Section title="Priced by Chainlink">
                <Card>
                    <Box sx={{ px: 2, py: 2, display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                        <Box sx={{ flex: '0 0 auto', pt: 0.25 }}><ChainlinkMark size={28} /></Box>
                        <Box>
                            <Typography fontSize={14} color="var(--bone)" sx={{ opacity: 0.9 }}>
                                Every dollar figure on Fyuz — the graduation threshold, the minimum initial buy, the market cap on a token page — comes from the Chainlink {chain?.currency ?? 'BNB'}/USD price feed, read on-chain by the contract itself. Fyuz cannot substitute its own price: if the feed goes stale, launches and pricing halt rather than run on a number nobody can verify.
                            </Typography>
                            <Typography fontSize={14} color="var(--bone)" sx={{ opacity: 0.9, mt: 1 }}>
                                Leaderboard prize draws use Chainlink VRF, so the randomness behind a payout is verifiable on-chain by anyone.
                            </Typography>
                            <Box sx={{ mt: 1.25 }}>
                                <a href="https://chain.link" target="_blank" rel="noopener noreferrer"
                                    style={{ fontFamily: 'var(--font-data)', fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--muted)', textDecoration: 'none' }}>
                                    Powered by Chainlink →
                                </a>
                            </Box>
                        </Box>
                    </Box>
                </Card>
            </Section>

            {/* Provenance */}
            <Box sx={{ mt: 4, pt: 2, borderTop: '1px solid var(--border)' }}>
                <Typography fontSize={12} color="var(--muted)">
                    {live
                        ? 'Figures on this page were read from the contract just now.'
                        : 'Showing published rates — the live contract read has not completed.'}
                    {' '}Fees are stored on-chain and can only be changed by the owner multisig, in a transaction anyone can see.
                    {explorer && (
                        <>
                            {' '}
                            <a href={explorer} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--citron)', textDecoration: 'none' }}>
                                Read them yourself on the explorer →
                            </a>
                        </>
                    )}
                </Typography>
                <Typography fontSize={12} color="var(--muted)" mt={1}>
                    Trading is risky and most tokens go to zero. Nothing here is financial advice.{' '}
                    <Link href="/create" style={{ color: 'var(--citron)', textDecoration: 'none' }}>Launch a token →</Link>
                </Typography>
            </Box>
        </PageBox>
    )
}
