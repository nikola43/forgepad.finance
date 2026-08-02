'use client'

import { useMainContext } from "@/context";
import { Box, IconButton, InputAdornment, Pagination, PaginationItem, Stack, styled, TextField, Typography, useMediaQuery } from "@mui/material";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API_ENDPOINT, STYLE_PRESETS } from "@/config";

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import ArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CheckIcon from '@mui/icons-material/Check';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import { useTokens, useKing, useHandlers } from "@/hooks/token";
import { useUserInfo } from "@/hooks/user";
import PageBox from "@/components/layout/pageBox";
import Link from "next/link";
import ComboBox from "@/components/ComboBox";
import TokenCard from "@/components/cards/token";
import TokenLogo from "@/components/tokenLogo";
import { CreatorName } from "@/components/cards/user";
import { priceFormatter } from "@/utils/price";
import { useRouter } from "next/navigation";
import { useAppKitAccount } from "@reown/appkit/react";
import { ChainController } from "@reown/appkit-controllers";
import toast from "react-hot-toast";
import CircularProgress from "@mui/material/CircularProgress";
import ActivityTicker from "@/components/ActivityTicker";
import PaybackStrip from "@/components/PaybackStrip";
import { TokenCardSkeleton, KingCardSkeleton } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";

const CreateButton = styled(Link)`
    border-radius: 12px;
    border: 1px solid rgba(234, 230, 218, 0.08);
    background: rgba(234, 230, 218, 0.03);
    color: var(--bone);
    font-family: var(--font-body);
    font-weight: 600;
    font-size: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 24px;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    &:hover {
        border-color: rgba(191, 209, 67, 0.3);
        background: rgba(191, 209, 67, 0.05);
    }
    &:active {
        transform: scale(0.98);
    }
    ${({ theme }) => theme.breakpoints.down(800)} {
        font-size: 20px;
    }
`

const SearchToken = styled(TextField)`
    align-self: stretch;
    flex: 1;
    & .MuiOutlinedInput-root {
        border-radius: 12px;
        border: 1px solid rgba(234, 230, 218, 0.06);
        background: rgba(234, 230, 218, 0.03);
        font-size: 14px;
        transition: all 0.2s ease;

        &:hover, &.Mui-focused {
            border-color: rgba(191, 209, 67, 0.25);
            background: rgba(234, 230, 218, 0.05);
        }

        & fieldset {
            border-color: transparent !important;
        }
    }
`;

const SearchButton = styled('button')`
    background: rgba(234, 230, 218, 0.04);
    border-radius: 12px;
    border: 1px solid rgba(234, 230, 218, 0.06);
    color: rgba(234, 230, 218, 0.5);
    font-size: 20px;
    display: flex;
    align-items: center;
    padding: 12px;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s ease;
    &:hover {
        border-color: rgba(191, 209, 67, 0.25);
        color: var(--bone);
        background: rgba(234, 230, 218, 0.06);
    }
`

// Citron price line for the Main Event spotlight card (fetches recent closes).
const KingSparkline = ({ address, network }: { address: string, network: string }) => {
    const [points, setPoints] = useState<number[]>([])
    useEffect(() => {
        let active = true
        axios.get(`${API_ENDPOINT}/trades/getChartData`, {
            params: {
                tokenAddress: address,
                interval: '15',
                from: 0,
                to: Math.floor(Date.now() / 1000) + 86400,
                countBack: 60,
            },
        }).then(({ data }) => {
            if (!active || !Array.isArray(data)) return
            const closes = data.map((d: any) => Number(d.close)).filter((n: number) => Number.isFinite(n))
            setPoints(closes.slice(-60))
        }).catch(() => { })
        return () => { active = false }
    }, [address, network])

    if (points.length < 2) return null
    const w = 240, h = 60, pad = 4
    const min = Math.min(...points), max = Math.max(...points)
    const range = max - min || 1
    const stepX = (w - pad * 2) / (points.length - 1)
    const coords = points.map((p, i): [number, number] => [
        pad + i * stepX,
        h - pad - ((p - min) / range) * (h - pad * 2),
    ])
    const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${h} L${coords[0][0].toFixed(1)},${h} Z`
    const stroke = '#BFD143'
    return (
        <Box sx={{ flex: '0 0 auto', display: { xs: 'none', md: 'block' }, width: w, pointerEvents: 'none' }}>
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block' }}>
                <path d={area} fill={stroke} fillOpacity={0.12} />
                <path
                    d={line}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </Box>
    )
}

const KingCard = styled(Box)`
    position: relative;
    border-radius: 20px;
    background: rgba(191, 209, 67, 0.06);
    border: 1px solid rgba(191, 209, 67, 0.2);
    padding: 24px;
    display: flex;
    align-items: center;
    gap: 20px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
    &:hover {
        border-color: rgba(191, 209, 67, 0.4);
    }
    &:active {
        transform: scale(0.98);
    }
    ${({ theme }) => theme.breakpoints.down(800)} {
        padding: 16px;
        gap: 14px;
    }
`

const KingCrown = styled(Box)`
    display: flex;
    align-items: center;
    gap: 8px;
`

const KingProgress = styled('div')<{ value: number }>`
    height: 4px;
    background: rgba(234, 230, 218, 0.06);
    border-radius: 100px;
    overflow: hidden;
    width: 100%;
    max-width: 200px;
    &::after {
        content: "";
        display: block;
        height: 100%;
        width: ${({ value }) => value}%;
        background: #BFD143;
        border-radius: 100px;
        transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }
`

const QuickBuyButton = styled('button')<{ loading?: number }>`
    background: rgba(234, 230, 218, 0.04);
    border: 1px solid rgba(234, 230, 218, 0.08);
    border-radius: 100px;
    color: rgba(234, 230, 218, 0.85);
    font-family: var(--font-data);
    font-weight: 600;
    font-size: 13px;
    padding: 8px 18px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    pointer-events: ${({ loading }) => loading ? 'none' : 'auto'};
    opacity: ${({ loading }) => loading ? 0.6 : 1};
    &:hover {
        background: rgba(191, 209, 67, 0.1);
        border-color: rgba(191, 209, 67, 0.3);
        color: #D3E063;
    }
    &:active {
        transform: scale(0.98);
    }
`

const CardGrid = styled(Box) <{ min: number, space: number }>`
    display: grid;
    width: 100%;
    align-items: stretch;
    // grid-auto-flow: row dense;
    grid-template-columns: repeat(auto-fill, minmax(${({ min }) => min}px, 1fr));
    gap: 16px ${({ space }) => space}px;

    ${({ theme }) => theme.breakpoints.down(400)} {
        grid-template-columns: 1fr;
    }
`;

const GraduatingSection = styled(Box)`
    position: relative;
    border-radius: 16px;
    background: var(--surface-dark);
    border: 1px solid rgba(191, 209, 67, 0.15);
    padding: 20px;
    overflow: hidden;
    .graduation-card {
        animation: grad-card-enter 0.5s ease-out both;
        transition: transform 0.3s ease;
        &:active {
            transform: scale(0.98);
        }
    }
    .graduation-card:nth-child(1) { animation-delay: 0s; }
    .graduation-card:nth-child(2) { animation-delay: 0.1s; }
    .graduation-card:nth-child(3) { animation-delay: 0.2s; }
    .graduation-card:nth-child(4) { animation-delay: 0.3s; }
    .graduation-card:nth-child(5) { animation-delay: 0.4s; }
    @keyframes grad-card-enter {
        from { opacity: 0; transform: translateY(16px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
    }
`;

const SectionDivider = () => (
    <Box sx={{
        height: '1px',
        background: 'var(--border)',
        my: 3
    }} />
);

export default function Home() {
    const [network, setNetwork] = useState('all');
    const [style, setStyle] = useState('all');
    const [orderType, setOrderType] = useState('marketcap');
    const [orderFlag] = useState('DESC');
    const [searchWord, setSearchWord] = useState('');
    const [pageNumber, setPageNumber] = useState(1);
    const [pageTrendsNumber, setPageTrendsNumber] = useState(1);
    const [inSearch, setInSearch] = useState(false);
    const [width, setWidth] = useState(0);
    const elementRef = useRef<HTMLElement>(undefined);

    const [quickBuyLoading, setQuickBuyLoading] = useState<string | null>(null)

    const router = useRouter()
    const { chains, appKit } = useMainContext()
    const isMobile = useMediaQuery('(max-width: 800px)')
    const { king } = useKing()
    const { isConnected } = useAppKitAccount()
    const { userInfo } = useUserInfo()
    const ethBalance = useMemo(() => userInfo?.balance ?? 0, [userInfo])

    const kingChain = useMemo(() => chains?.find(c => c.network === king?.network), [chains, king])
    const allNetworks = ChainController.getCaipNetworks()
    const kingNetwork = useMemo(() => {
        if (!kingChain) return undefined
        return allNetworks.find(n => n.id === kingChain.chainId || n.chainNamespace === kingChain.chainId)
    }, [allNetworks, kingChain])
    const handlers = useHandlers(kingNetwork)

    const handleQuickBuy = async (amount: string, label: string) => {
        if (!isConnected) {
            appKit?.open()
            return
        }
        if (!handlers || !king) {
            toast.error('Unable to connect to network')
            return
        }
        setQuickBuyLoading(label)
        try {
            const slippage = 100n // 1%
            const tx = await handlers.buyToken(king.tokenAddress, amount, slippage, true)
            const txHash = tx.hash
            const shortHash = `${txHash.slice(0, 6)}...${txHash.slice(-6)}`
            const link = `${kingChain?.explorerUrl}/tx/${txHash}`
            toast.success(
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontWeight: 600 }}>Buy successful</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#6F6F68', fontSize: '12px', fontFamily: 'var(--font-data)' }}>TX: {shortHash}</span>
                        <a style={{ textDecoration: 'none', color: '#BFD143', fontSize: '12px', fontWeight: 500 }} target="_blank" rel="noreferrer" href={link}>View</a>
                    </div>
                </div>,
                { duration: 8000 }
            )
        } catch (error: any) {
            const msg = error?.shortMessage || error?.data?.message || error?.message || 'Transaction failed'
            toast.error(msg)
        } finally {
            setQuickBuyLoading(null)
        }
    }

    const searchTokenInputProps = useMemo(() => ({
        startAdornment: (
            <InputAdornment position="start">
                {
                    inSearch
                        ? <ArrowBackIcon onClick={() => setInSearch(false)} />
                        : <SearchIcon sx={{ width: { md: 36, sm: 24, xs: 24 }, height: { md: 36, sm: 24, xs: 24 } }} />
                }
            </InputAdornment>
        ),
        endAdornment: (
            <InputAdornment style={{ cursor: "pointer", visibility: searchWord.length > 0 ? 'visible' : 'hidden' }} position="end" onClick={() => {
                setSearchWord('')
            }}>
                <CloseIcon sx={{ height: 18 }} />
            </InputAdornment>
        )
    }), [searchWord, inSearch])

    const pageSize = useMemo(() => {
        const cols = Math.floor((width + 32) / 382)
        if (cols === 0)
            return 5
        if (cols < 3)
            return cols * 5
        if (cols < 5)
            return cols * 4
        return cols * 3
    }, [width])

    const pageTrendSize = useMemo(() => {
        return Math.floor((width + 12) / 192)
    }, [width])

    const { tokens, count } = useTokens({
        network, style, searchWord, orderType, orderFlag, pageNumber, pageSize
    })

    const { tokens: trends } = useTokens({
        pageNumber: pageTrendsNumber, pageSize: pageTrendSize
    })

    const { tokens: graduatingTokens } = useTokens({
        pageNumber: 1, pageSize: 6, orderType: 'progress', orderFlag: 'DESC'
    })

    const filteredGraduatingTokens = useMemo(() => {
        return graduatingTokens.filter((token: any) =>
            Number(token.progress ?? 0) > 70 && !token.launchedAt
        )
    }, [graduatingTokens])

    const totalPage = useMemo(() => {
        return Math.floor(count / pageSize) + (count % pageSize === 0 ? 0 : 1)
    }, [count, pageSize])

    useLayoutEffect(() => {
        const updateWidth = () => {
            if (elementRef.current) {
                setWidth(elementRef.current.offsetWidth);
            }
        };
        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => {
            window.removeEventListener('resize', updateWidth);
        };
    }, [])

    const handleChange = (event: any, value: any) => {
        setPageNumber(value);
        // This logs the current page number to the console
    };

    return (
        <>
            {/* Live-trades marquee, pinned to the very top of the view: outside
                PageBox so it spans full-bleed instead of being boxed to 1440px,
                with a negative margin cancelling Main's padding-top surplus over
                the fixed 64px header (90px desktop / 72px under 800px). */}
            <Box sx={{ mt: '-26px', '@media (max-width: 800px)': { mt: '-8px' } }}>
                <ActivityTicker />
            </Box>
        <PageBox>
            {/* SEO: crawlable heading + intro (visually hidden, no layout impact) */}
            <div style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>
                <h1>Fyuz — Launch and Trade Tokens on BNB Smart Chain</h1>
                <p>
                    Fyuz is the token launchpad for BNB Smart Chain. Create a memecoin in seconds on a fair
                    bonding curve, trade instantly with low 1% fees, and automatically graduate liquidity to PancakeSwap.
                    The pump.fun of BNB Chain.
                </p>
            </div>
            {/* The payback claim, above the fold: what has actually been paid out,
                linked to the round-by-round receipts. */}
            <PaybackStrip />
            {/* Main Event Section (highest market cap spotlight) */}
            {king === undefined ? (
                <Box my={2}>
                    <Box display="flex" gap="8px" p="0 4px" mb={1.5} alignItems="center">
                        <KingCrown>
                            <EmojiEventsIcon sx={{ fontSize: 24, color: 'var(--tangerine)' }} />
                            <Typography fontSize={14} fontWeight={700} color="var(--bone)" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.02em">
                                Main Event
                            </Typography>
                        </KingCrown>
                        <Typography fontSize={12} color="#6F6F68" ml="auto">Highest Market Cap</Typography>
                    </Box>
                    <KingCardSkeleton />
                </Box>
            ) : king && (
                <Box my={2}>
                    <Box display="flex" gap="8px" p="0 4px" mb={1.5} alignItems="center">
                        <KingCrown>
                            <EmojiEventsIcon sx={{ fontSize: 24, color: 'var(--tangerine)' }} />
                            <Typography fontSize={14} fontWeight={700} color="var(--bone)" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.02em">
                                Main Event
                            </Typography>
                        </KingCrown>
                        <Typography fontSize={12} color="#6F6F68" ml="auto">Highest Market Cap</Typography>
                    </Box>
                    <KingCard onClick={() => router.push(`/token?network=${king.network}&address=${king.tokenAddress}`)}>
                        <TokenLogo logo={king.tokenImage} size={isMobile ? "64px" : "80px"} style={{ borderRadius: '12px', flexShrink: 0 }} />
                        <Box flex={1} minWidth={0}>
                            <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                                <Typography fontSize={{ xs: 18, sm: 22 }} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" letterSpacing="-0.02em" noWrap>
                                    {king.tokenName}
                                </Typography>
                                <Typography fontSize={14} color="#8C8C85" fontWeight={500} fontFamily="var(--font-data)">
                                    {king.tokenSymbol}
                                </Typography>
                                <img src={`/networks/${king.network}.svg`} height={18} alt="" />
                            </Box>
                            <Box display="flex" alignItems="center" gap="16px" mt={1} flexWrap="wrap">
                                <Box>
                                    <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">Market Cap</Typography>
                                    <Typography fontSize={20} fontWeight={700} color="#BFD143" fontFamily="var(--font-data)">
                                        ${priceFormatter(king.marketcap, 2)}
                                    </Typography>
                                </Box>
                                {!isMobile && (
                                    <>
                                        <Box sx={{ width: '1px', height: 32, background: 'rgba(234,230,218,0.08)' }} />
                                        <Box>
                                            <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">Volume</Typography>
                                            <Typography fontSize={14} fontWeight={600} color="var(--bone)" fontFamily="var(--font-data)">
                                                ${priceFormatter(king.volume, 2, true, true)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ width: '1px', height: 32, background: 'rgba(234,230,218,0.08)' }} />
                                        <Box>
                                            <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">Creator</Typography>
                                            <Box display="flex" alignItems="center" mt={0.5}>
                                                <CreatorName token={king} fontSize={13} />
                                            </Box>
                                        </Box>
                                    </>
                                )}
                                {!king.launchedAt && (
                                    <>
                                        <Box sx={{ width: '1px', height: 32, background: 'rgba(234,230,218,0.08)' }} />
                                        <Box flex={1} minWidth={100}>
                                            <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">
                                                Progress {Number(king.progress ?? 0).toFixed(1)}%
                                            </Typography>
                                            <Box mt={0.5}>
                                                <KingProgress value={Math.min(100, Number(king.progress ?? 0))} />
                                            </Box>
                                        </Box>
                                    </>
                                )}
                            </Box>
                        </Box>
                        <KingSparkline address={king.tokenAddress} network={king.network} />
                        {king.priceChange !== undefined && (
                            <Box
                                sx={{
                                    background: Number(king.priceChange) >= 0 ? 'rgba(63, 169, 104, 0.1)' : 'rgba(214, 69, 69, 0.1)',
                                    border: `1px solid ${Number(king.priceChange) >= 0 ? 'rgba(63, 169, 104, 0.2)' : 'rgba(214, 69, 69, 0.2)'}`,
                                    borderRadius: '10px',
                                    px: 1.5,
                                    py: 0.8,
                                    flexShrink: 0,
                                }}
                            >
                                <Typography
                                    fontSize={13}
                                    fontWeight={700}
                                    fontFamily="var(--font-data)"
                                    color={Number(king.priceChange) >= 0 ? 'var(--up)' : 'var(--down)'}
                                >
                                    {Number(king.priceChange) >= 0 ? '+' : ''}{Number(king.priceChange).toFixed(2)}%
                                </Typography>
                            </Box>
                        )}
                    </KingCard>
                    <Box display="flex" gap="8px" mt={1.5} flexWrap="wrap" px={0.5}>
                        {(['0.005', '0.01', '0.05', '0.1'] as const).map(amt => (
                            <QuickBuyButton
                                key={amt}
                                loading={quickBuyLoading === amt ? 1 : 0}
                                onClick={(e) => { e.stopPropagation(); handleQuickBuy(amt, amt) }}
                            >
                                {quickBuyLoading === amt && <CircularProgress size={12} sx={{ color: '#BFD143' }} />}
                                {amt} BNB
                            </QuickBuyButton>
                        ))}
                    </Box>
                </Box>
            )}

            <SectionDivider />

            {/* Tonight's Card Section (trending feed) */}
            <Box display="flex" gap="10px" p="0 4px" my={2} alignItems="center">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: '#3FA968', animation: 'glow-pulse 2s ease-in-out infinite' }} />
                <Typography fontSize={13} fontWeight={600} color="rgba(234,230,218,0.7)" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.01em">Tonight's Card</Typography>
                <Box sx={{ ml: "auto", display: "flex", gap: "4px" }}>
                    <IconButton size="small" sx={{ background: 'rgba(234,230,218,0.04)', '&:hover': { background: 'rgba(234,230,218,0.08)' } }} onClick={() => pageTrendsNumber > 1 && setPageTrendsNumber(pageTrendsNumber - 1)}>
                        <ArrowBackIcon sx={{ width: 14, height: 14 }} />
                    </IconButton>
                    <IconButton size="small" sx={{ background: 'rgba(234,230,218,0.04)', '&:hover': { background: 'rgba(234,230,218,0.08)' } }} onClick={() => pageTrendsNumber < 5 && setPageTrendsNumber(pageTrendsNumber + 1)}>
                        <ArrowForwardIcon sx={{ width: 14, height: 14 }} />
                    </IconButton>
                </Box>
            </Box>
            {trends.length === 0 ? (
                <CardGrid min={180} space={12} ref={elementRef} className="stagger-children">
                    {Array.from({ length: pageTrendSize || 4 }).map((_, i) => (
                        <TokenCardSkeleton key={`trend-skeleton-${i}`} mode="trends" />
                    ))}
                </CardGrid>
            ) : (
                <CardGrid min={180} space={12} ref={elementRef} className="stagger-children">
                    {
                        trends.slice(0, pageTrendSize).map((item: any) => (
                            <TokenCard key={`trend-token-${item.tokenAddress}`} token={item} mode="trends" />
                        ))
                    }
                </CardGrid>
            )}

            <SectionDivider />

            {/* Title Shot Section (About to Graduate) */}
            {filteredGraduatingTokens.length > 0 && (
                <>
                    <Box display="flex" gap="10px" p="0 4px" my={2} alignItems="center">
                        <WhatshotIcon sx={{ fontSize: 16, color: 'var(--citron)', animation: 'pulse 2s ease-in-out infinite' }} />
                        <Typography fontSize={13} fontWeight={600} color="rgba(234,230,218,0.7)" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.01em">
                            Title Shot
                        </Typography>
                        <Box sx={{
                            display: 'flex', alignItems: 'center', gap: 1, ml: 'auto',
                            background: 'rgba(191,209,67,0.08)', borderRadius: '8px', px: 1.5, py: 0.5,
                            border: '1px solid rgba(191,209,67,0.15)',
                        }}>
                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: '#BFD143', animation: 'pulse 1.5s ease-in-out infinite' }} />
                            <Typography fontSize={11} color="#BFD143" fontWeight={600} fontFamily="var(--font-data)">
                                Progress &gt; 70%
                            </Typography>
                        </Box>
                    </Box>
                    <GraduatingSection>
                        <Box
                            sx={{
                                display: 'flex',
                                gap: '16px',
                                overflowX: 'auto',
                                pb: 1,
                                justifyContent: filteredGraduatingTokens.length <= 3 ? 'center' : 'flex-start',
                                '&::-webkit-scrollbar': { height: 4 },
                                '&::-webkit-scrollbar-track': { background: 'transparent' },
                                '&::-webkit-scrollbar-thumb': { background: 'rgba(191,209,67,0.3)', borderRadius: 2 },
                            }}
                        >
                            {filteredGraduatingTokens.map((item: any) => (
                                <Box key={`graduating-${item.tokenAddress}`} className="graduation-card" sx={{
                                    minWidth: 200, flex: '0 0 auto',
                                    position: 'relative',
                                    borderRadius: '14px',
                                    overflow: 'hidden',
                                    '&::after': {
                                        content: '""',
                                        position: 'absolute',
                                        bottom: 0,
                                        left: 0,
                                        height: '3px',
                                        width: `${Math.min(99, Number(item.progress ?? 0))}%`,
                                        background: '#BFD143',
                                        borderRadius: '0 3px 3px 0',
                                        transition: 'width 1s ease-out',
                                    }
                                }}>
                                    <TokenCard token={item} mode="trends" />
                                </Box>
                            ))}
                        </Box>
                    </GraduatingSection>

                    <SectionDivider />
                </>
            )}

            {/* The Undercard Section Header with Sort/Filter (all tokens) */}
            <Box display="flex" gap="10px" p="0 4px" my={2} alignItems="center" flexWrap="wrap">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: '#BFD143' }} />
                <Typography fontSize={13} fontWeight={600} color="rgba(234,230,218,0.7)" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.01em">
                    The Undercard
                </Typography>
                <Box display="flex" gap="8px" ml="auto" flexWrap="wrap">
                    <ComboBox label="Sort" border="1px solid #BFD143" values={{
                        bump: 'Trending',
                        marketcap: 'Market cap',
                        creationTime: 'Creation time',
                        volume: 'Trading volume',
                        // progress: 'Progress'
                    }} value={orderType} onChange={setOrderType} />
                    <ComboBox label="Network" border="1px solid #BFD143" values={{
                        all: 'All',
                        ...(
                            chains?.reduce((networks, c) => ({
                                ...networks, [c.network]: c.name
                            }), {})
                        )
                    }} value={network} onChange={setNetwork} />
                    <ComboBox label="Style" border="1px solid #BFD143" values={{
                        all: 'All',
                        ...Object.fromEntries(STYLE_PRESETS.map(s => [s, s]))
                    }} value={style} onChange={setStyle} />
                </Box>
            </Box>

            {/* Token Grid */}
            {
                tokens.length > 0 ?
                    <CardGrid min={350} space={32} mb={4} className="stagger-children">
                        {
                            tokens.map((item: any) => (
                                <TokenCard key={item.tokenAddress} token={item} mode="list" />
                            ))
                        }
                    </CardGrid> :
                    count === 0 && (searchWord || network !== 'all' || style !== 'all') ?
                        <EmptyState
                            icon={<SearchIcon sx={{ fontSize: 32, color: 'var(--muted)' }} />}
                            title="No tokens found"
                            description="Try adjusting your filters or search terms"
                        /> :
                        tokens.length === 0 ?
                            <CardGrid min={350} space={32} mb={4} className="stagger-children">
                                {Array.from({ length: pageSize || 6 }).map((_, i) => (
                                    <TokenCardSkeleton key={`token-skeleton-${i}`} mode="list" />
                                ))}
                            </CardGrid> :
                            null
            }

            {/* Pagination */}
            {
                totalPage > 1 &&
                <Box sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    py: 4,
                    mb: 4,
                }}>
                    <Stack spacing={2}>
                        <Pagination
                            variant="text"
                            shape="circular"
                            siblingCount={0}
                            boundaryCount={1}
                            count={totalPage}
                            page={pageNumber}  // current page
                            onChange={handleChange}  // handle page change
                            // renderItem={(data) => (
                            //     <PaginationItem
                            //         slots={{ previous: ArrowBackIcon, next: ArrowForwardIcon }}
                            //         {...data}
                            //     />
                            // )}
                        />
                    </Stack>
                </Box>
            }
        </PageBox>
        </>
    );
}
