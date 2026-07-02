'use client'

import { useMainContext } from "@/context";
import { Box, IconButton, InputAdornment, Pagination, PaginationItem, Stack, styled, TextField, Typography, useMediaQuery } from "@mui/material";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import ArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CheckIcon from '@mui/icons-material/Check';
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
import { TokenCardSkeleton, KingCardSkeleton } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";

const CreateButton = styled(Link)`
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    color: white;
    font-family: 'Space Grotesk', 'Inter', sans-serif;
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
        border-color: rgba(209, 255, 26, 0.3);
        background: rgba(209, 255, 26, 0.05);
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(209, 255, 26, 0.1);
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
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(255, 255, 255, 0.03);
        font-size: 14px;
        transition: all 0.2s ease;

        &:hover, &.Mui-focused {
            border-color: rgba(209, 255, 26, 0.25);
            background: rgba(255, 255, 255, 0.05);
        }

        & fieldset {
            border-color: transparent !important;
        }
    }
`;

const SearchButton = styled('button')`
    background: rgba(255, 255, 255, 0.04);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.5);
    font-size: 20px;
    display: flex;
    align-items: center;
    padding: 12px;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s ease;
    &:hover {
        border-color: rgba(209, 255, 26, 0.25);
        color: white;
        background: rgba(255, 255, 255, 0.06);
    }
`

const KingCard = styled(Box)`
    position: relative;
    border-radius: 20px;
    background: linear-gradient(135deg, rgba(209, 255, 26, 0.08) 0%, rgba(139, 92, 246, 0.06) 50%, rgba(209, 255, 26, 0.04) 100%);
    border: 1px solid rgba(209, 255, 26, 0.2);
    padding: 24px;
    display: flex;
    align-items: center;
    gap: 20px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
    &::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1px;
        background: linear-gradient(135deg, rgba(209, 255, 26, 0.5), rgba(228, 255, 102, 0.3), rgba(139, 92, 246, 0.2));
        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        opacity: 0.6;
        pointer-events: none;
    }
    &:hover {
        transform: translateY(-3px);
        border-color: rgba(209, 255, 26, 0.4);
        box-shadow: 0 12px 40px rgba(209, 255, 26, 0.12), 0 0 60px rgba(209, 255, 26, 0.06);
        &::before { opacity: 1; }
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
    & .crown {
        font-size: 24px;
        filter: drop-shadow(0 0 8px rgba(228, 255, 102, 0.5));
    }
    ${({ theme }) => theme.breakpoints.down(800)} {
        & .crown { font-size: 18px; }
    }
`

const KingProgress = styled('div')<{ value: number }>`
    height: 4px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 100px;
    overflow: hidden;
    width: 100%;
    max-width: 200px;
    &::after {
        content: "";
        display: block;
        height: 100%;
        width: ${({ value }) => value}%;
        background: linear-gradient(90deg, #d1ff1a, #e4ff66);
        box-shadow: 0 0 8px rgba(209, 255, 26, 0.4);
        border-radius: 100px;
        transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }
`

const QuickBuyButton = styled('button')<{ loading?: number }>`
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 100px;
    color: rgba(255, 255, 255, 0.85);
    font-family: 'Space Grotesk', 'Inter', sans-serif;
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
        background: rgba(209, 255, 26, 0.1);
        border-color: rgba(209, 255, 26, 0.3);
        color: #e4ff66;
    }
    &:active {
        transform: scale(0.96);
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
    background: linear-gradient(135deg, rgba(168, 212, 0, 0.05) 0%, rgba(13, 13, 20, 0.8) 40%, rgba(209, 255, 26, 0.03) 100%);
    border: 1px solid rgba(168, 212, 0, 0.15);
    padding: 20px;
    overflow: hidden;
    &::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: radial-gradient(ellipse at 30% 0%, rgba(168, 212, 0, 0.1) 0%, transparent 50%),
                    radial-gradient(ellipse at 70% 100%, rgba(209, 255, 26, 0.06) 0%, transparent 50%);
        pointer-events: none;
    }
    &::after {
        content: "";
        position: absolute;
        top: -1px;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, transparent, rgba(196, 239, 14, 0.6), rgba(228, 255, 102, 0.8), rgba(196, 239, 14, 0.6), transparent);
        background-size: 200% 100%;
        animation: graduating-border-glow 3s ease-in-out infinite;
        border-radius: 16px 16px 0 0;
    }
    @keyframes graduating-border-glow {
        0%, 100% { background-position: 200% 0; }
        50% { background-position: -200% 0; }
    }
    .graduation-card {
        animation: grad-card-enter 0.5s ease-out both;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        &:hover {
            transform: translateY(-4px) scale(1.02);
            box-shadow: 0 8px 32px rgba(196, 239, 14, 0.2);
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
        background: 'linear-gradient(90deg, transparent, rgba(209,255,26,0.15), transparent)',
        my: 3
    }} />
);

export default function Home() {
    const [network, setNetwork] = useState('all');
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
                        <span style={{ color: '#64748B', fontSize: '12px', fontFamily: 'monospace' }}>TX: {shortHash}</span>
                        <a style={{ textDecoration: 'none', color: '#d1ff1a', fontSize: '12px', fontWeight: 500 }} target="_blank" rel="noreferrer" href={link}>View</a>
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
        network, searchWord, orderType, orderFlag, pageNumber, pageSize
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
        <PageBox>
            {/* King of the Hill Section */}
            {king === undefined ? (
                <Box my={2}>
                    <Box display="flex" gap="8px" p="0 4px" mb={1.5} alignItems="center">
                        <KingCrown>
                            <span className="crown">👑</span>
                            <Typography fontSize={14} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.02em">
                                King of the Hill
                            </Typography>
                        </KingCrown>
                        <Typography fontSize={12} color="#64748B" ml="auto">Highest Market Cap</Typography>
                    </Box>
                    <KingCardSkeleton />
                </Box>
            ) : king && (
                <Box my={2}>
                    <Box display="flex" gap="8px" p="0 4px" mb={1.5} alignItems="center">
                        <KingCrown>
                            <span className="crown">👑</span>
                            <Typography fontSize={14} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.02em">
                                King of the Hill
                            </Typography>
                        </KingCrown>
                        <Typography fontSize={12} color="#64748B" ml="auto">Highest Market Cap</Typography>
                    </Box>
                    <KingCard onClick={() => router.push(`/token?network=${king.network}&address=${king.tokenAddress}`)}>
                        <TokenLogo logo={king.tokenImage} size={isMobile ? "64px" : "80px"} style={{ borderRadius: '12px', flexShrink: 0 }} />
                        <Box flex={1} minWidth={0}>
                            <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                                <Typography fontSize={{ xs: 18, sm: 22 }} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.02em" noWrap>
                                    {king.tokenName}
                                </Typography>
                                <Typography fontSize={14} color="#94A3B8" fontWeight={500}>
                                    {king.tokenSymbol}
                                </Typography>
                                <img src={`/networks/${king.network}.svg`} height={18} alt="" />
                            </Box>
                            <Box display="flex" alignItems="center" gap="16px" mt={1} flexWrap="wrap">
                                <Box>
                                    <Typography fontSize={11} color="#64748B" fontWeight={500} textTransform="uppercase" letterSpacing="0.05em">Market Cap</Typography>
                                    <Typography fontSize={20} fontWeight={700} color="#e4ff66" fontFamily="'Space Grotesk', sans-serif">
                                        ${priceFormatter(king.marketcap, 2)}
                                    </Typography>
                                </Box>
                                {!isMobile && (
                                    <>
                                        <Box sx={{ width: '1px', height: 32, background: 'rgba(255,255,255,0.08)' }} />
                                        <Box>
                                            <Typography fontSize={11} color="#64748B" fontWeight={500} textTransform="uppercase" letterSpacing="0.05em">Volume</Typography>
                                            <Typography fontSize={14} fontWeight={600} color="white">
                                                ${priceFormatter(king.volume, 2, true, true)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ width: '1px', height: 32, background: 'rgba(255,255,255,0.08)' }} />
                                        <Box>
                                            <Typography fontSize={11} color="#64748B" fontWeight={500} textTransform="uppercase" letterSpacing="0.05em">Creator</Typography>
                                            <Box display="flex" alignItems="center" mt={0.5}>
                                                <CreatorName token={king} fontSize={13} />
                                            </Box>
                                        </Box>
                                    </>
                                )}
                                {!king.launchedAt && (
                                    <>
                                        <Box sx={{ width: '1px', height: 32, background: 'rgba(255,255,255,0.08)' }} />
                                        <Box flex={1} minWidth={100}>
                                            <Typography fontSize={11} color="#64748B" fontWeight={500} textTransform="uppercase" letterSpacing="0.05em">
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
                        {king.priceChange !== undefined && (
                            <Box
                                sx={{
                                    background: Number(king.priceChange) >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                    border: `1px solid ${Number(king.priceChange) >= 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                                    borderRadius: '10px',
                                    px: 1.5,
                                    py: 0.8,
                                    flexShrink: 0,
                                }}
                            >
                                <Typography
                                    fontSize={13}
                                    fontWeight={700}
                                    color={Number(king.priceChange) >= 0 ? '#10B981' : '#EF4444'}
                                >
                                    {Number(king.priceChange) >= 0 ? '+' : ''}{Number(king.priceChange).toFixed(2)}%
                                </Typography>
                            </Box>
                        )}
                    </KingCard>
                    <Box display="flex" gap="8px" mt={1.5} flexWrap="wrap" px={0.5}>
                        {(['0.1', '0.2', '1'] as const).map(amt => (
                            <QuickBuyButton
                                key={amt}
                                loading={quickBuyLoading === amt ? 1 : 0}
                                onClick={(e) => { e.stopPropagation(); handleQuickBuy(amt, amt) }}
                            >
                                {quickBuyLoading === amt && <CircularProgress size={12} sx={{ color: '#e4ff66' }} />}
                                {amt} BNB
                            </QuickBuyButton>
                        ))}
                        <QuickBuyButton
                            loading={quickBuyLoading === 'max' ? 1 : 0}
                            onClick={(e) => {
                                e.stopPropagation()
                                if (ethBalance > 0.01) {
                                    handleQuickBuy((ethBalance - 0.005).toFixed(6), 'max')
                                } else {
                                    toast.error('Insufficient balance')
                                }
                            }}
                        >
                            {quickBuyLoading === 'max' && <CircularProgress size={12} sx={{ color: '#e4ff66' }} />}
                            MAX
                        </QuickBuyButton>
                    </Box>
                </Box>
            )}

            <SectionDivider />

            {/* Trending Section */}
            <Box display="flex" gap="10px" p="0 4px" my={2} alignItems="center">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 8px #10B981', animation: 'glow-pulse 2s ease-in-out infinite' }} />
                <Typography fontSize={13} fontWeight={600} color="rgba(255,255,255,0.7)" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.01em">Trending</Typography>
                <Box sx={{ ml: "auto", display: "flex", gap: "4px" }}>
                    <IconButton size="small" sx={{ background: 'rgba(255,255,255,0.04)', '&:hover': { background: 'rgba(255,255,255,0.08)' } }} onClick={() => pageTrendsNumber > 1 && setPageTrendsNumber(pageTrendsNumber - 1)}>
                        <ArrowBackIcon sx={{ width: 14, height: 14 }} />
                    </IconButton>
                    <IconButton size="small" sx={{ background: 'rgba(255,255,255,0.04)', '&:hover': { background: 'rgba(255,255,255,0.08)' } }} onClick={() => pageTrendsNumber < 5 && setPageTrendsNumber(pageTrendsNumber + 1)}>
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

            {/* About to Graduate Section */}
            {filteredGraduatingTokens.length > 0 && (
                <>
                    <Box display="flex" gap="10px" p="0 4px" my={2} alignItems="center">
                        <Box sx={{
                            fontSize: 16, lineHeight: 1,
                            animation: 'pulse 2s ease-in-out infinite',
                            filter: 'drop-shadow(0 0 4px rgba(168,212,0,0.5))',
                        }}>🔥</Box>
                        <Typography fontSize={13} fontWeight={600} color="rgba(255,255,255,0.7)" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.01em">
                            About to Graduate
                        </Typography>
                        <Box sx={{
                            display: 'flex', alignItems: 'center', gap: 1, ml: 'auto',
                            background: 'rgba(196,239,14,0.08)', borderRadius: '8px', px: 1.5, py: 0.5,
                            border: '1px solid rgba(196,239,14,0.15)',
                        }}>
                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: '#c4ef0e', boxShadow: '0 0 8px #c4ef0e', animation: 'pulse 1.5s ease-in-out infinite' }} />
                            <Typography fontSize={11} color="#d1ff1a" fontWeight={600}>
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
                                '&::-webkit-scrollbar-thumb': { background: 'rgba(209,255,26,0.3)', borderRadius: 2 },
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
                                        background: 'linear-gradient(90deg, #a8d400, #e4ff66)',
                                        borderRadius: '0 3px 3px 0',
                                        boxShadow: '0 0 12px rgba(228,255,102,0.4)',
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

            {/* All Tokens Section Header with Sort/Filter */}
            <Box display="flex" gap="10px" p="0 4px" my={2} alignItems="center" flexWrap="wrap">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: '#d1ff1a', boxShadow: '0 0 8px #d1ff1a' }} />
                <Typography fontSize={13} fontWeight={600} color="rgba(255,255,255,0.7)" fontFamily="'Space Grotesk', sans-serif" letterSpacing="-0.01em">
                    All Tokens
                </Typography>
                <Box display="flex" gap="8px" ml="auto" flexWrap="wrap">
                    <ComboBox label="Sort" border="1px solid #c4ef0e" values={{
                        bump: 'Trending',
                        marketcap: 'Market cap',
                        creationTime: 'Creation time',
                        volume: 'Trading volume',
                        // progress: 'Progress'
                    }} value={orderType} onChange={setOrderType} />
                    <ComboBox label="Network" border="1px solid #c4ef0e" values={{
                        all: 'All',
                        ...(
                            chains?.reduce((networks, c) => ({
                                ...networks, [c.network]: c.name
                            }), {})
                        )
                    }} value={network} onChange={setNetwork} />
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
                    count === 0 && (searchWord || network !== 'all') ?
                        <EmptyState
                            icon="🔍"
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
    );
}
