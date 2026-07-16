'use client'

import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CountUp from "react-countup";
import { useTheme, useMediaQuery, styled } from '@mui/material';
import { Alert, Avatar, Box, Button, Dialog, DialogContent, DialogTitle, FormControl, IconButton, Pagination, PaginationItem, Typography } from "@mui/material";
import CircularProgress from '@mui/material/CircularProgress';
import LinkIcon from '@mui/icons-material/OpenInNewOutlined';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CopyIcon from '@mui/icons-material/ContentCopy';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { useWatchlist } from "@/hooks/watchlist";
import copy from 'copy-to-clipboard';
import { ethers, MaxUint256, BrowserProvider } from 'ethers';
import { NumericFormat } from "react-number-format";
import PageBox from "@/components/layout/pageBox";
import TokenLogo from "@/components/tokenLogo";
import { priceFormatter } from "@/utils/price";
import Toggle from "@/components/toggle";
import { Creator, User, UserAvatar, UserName } from "@/components/cards/user";

// import imgUniswap from '@/assets/images/uniswap.png';
// import marketcapIcon from '@/assets/images/marketcap.png';
import TelegramIcon from '@/assets/images/telegram.svg';
import TwitterIcon from '@/assets/images/x.svg';
import WebsiteIcon from '@/assets/images/website.svg';
// import ethIcon from '@/assets/images/coin/eth-1.png';

import { TVChartContainer as TVChartContainerAdvanced } from '@/components/tvchart';
import TokenAnalyticsPanel from '@/components/TokenAnalyticsPanel';
import StreamPanel from '@/components/StreamPanel';
import { useStreamStatus } from '@/hooks/stream';
import { playBuySound, playSellSound } from '@/utils/sounds';
import { TimeDiff } from "@/components/time";
// import { useContractInfo } from "@/hooks/contract";
import { useHandlers, useTokenInfo } from "@/hooks/token";
import toast from "react-hot-toast";
import { useAppKit, useAppKitAccount, useAppKitNetwork, type Provider as EVMProvider, useAppKitProvider } from "@reown/appkit/react";
import { useMainContext } from "@/context";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
// import { useUserInfo } from "@/hooks/user";
// import { useChainInfo, useContractInfo, useSwitchChain } from "@/hooks/config";
import { AssetUtil, ChainController } from "@reown/appkit-controllers"
import { AppKitNetwork } from "@reown/appkit/networks";
import { useUserInfo } from "@/hooks/user";
import SendIcon from '@mui/icons-material/Send';
import ReplyIcon from '@mui/icons-material/Reply';
import axios from "axios";
import { API_ENDPOINT } from "@/config";

const SlippageInput = styled("input") <{ slippage: number }>`
  width: 48px;
  height: 24px;
  padding: 12px;
  font-size: 16px;
  border-radius: 16px;
  border: 2px solid ${({ slippage }) => (slippage !== 0.1 && slippage !== 0.5 && slippage !== 1 ? 'white' : '#333')};
  outline: none;
  background-color: transparent;
  color: white;
  transition: border-color 0.2s ease-in-out;
  text-align: center;

  &:focus {
    border-color: #6a5acd;
  }

  &::placeholder {
    color: #bbb;
  }
`;

const Divider = styled('hr')`
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
`

const Progress = styled('div') <{ value: number }>`
    max-width: 400px;
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.06);
    position: relative;
    border-radius: 100px;
    overflow: hidden;
    &::after {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: ${({ value }) => value}%;
        background: linear-gradient(90deg, #D3FF24, #e4ff66);
        box-shadow: 0 0 12px rgba(209, 255, 26, 0.4);
        border-radius: 100px;
        transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }
    ${({ value }) => value > 90 ? `
        &::after {
            animation: graduation-glow 1.5s ease-in-out infinite;
        }
        @keyframes graduation-glow {
            0%, 100% {
                box-shadow: 0 0 12px rgba(209, 255, 26, 0.4);
            }
            50% {
                box-shadow: 0 0 24px rgba(228, 255, 102, 0.8), 0 0 48px rgba(209, 255, 26, 0.4);
            }
        }
    ` : ''}
    @media(max-width: 800px) {
        min-width: 200px;
    }
`

const SmallButton = styled(Button)`
    &.MuiButton-root {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 8px;
        color: #94A3B8;
        font-size: 12px;
        font-weight: 500;
        padding: 3px 10px;
        text-transform: none;
        transition: all 0.2s ease;
        &:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(209, 255, 26, 0.2);
            color: white;
        }
    }
`

const TradeMenu = styled('div')`
    position: fixed;
    z-index: 2;
    display: flex;
    left: 0;
    bottom: 0;
    right: 0;
    justify-content: space-around;
    gap: 8px;
    padding: 8px 12px;
    padding-bottom: max(8px, env(safe-area-inset-bottom));
    background: rgba(6, 6, 10, 0.9);
    backdrop-filter: blur(20px);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    & > button {
        flex: 1;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.06);
        outline: none;
        border-radius: 10px;
        color: white;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        &:active {
            transform: scale(0.97);
        }
    }
`

const StatsBox = styled('div')`
    margin-top: 4px;
    display: flex;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 8px;
    padding: 6px 10px;
    gap: 6px;
`

const CurrencyInput = styled(Box)`
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 12px 16px;
  gap: 8px;
  transition: border-color 0.2s ease;
  &:focus-within {
    border-color: rgba(209, 255, 26, 0.3);
  }
  & span.balance {
    align-self: flex-end;
    color: #64748B;
    font-size: 12px;
    font-weight: 500;
  }
  & input {
    font-size: 20px;
    background: transparent;
    color: white;
    border: none;
    outline: none;
    width: 100%;
    text-align: right;
    font-weight: 600;
  }
  ${({ theme }) => theme.breakpoints.down("sm")} {
    padding: 10px 14px;
  }
  & span.balance {
    ${({ theme }) => theme.breakpoints.down("sm")} {
      font-size: 11px;
    }
  }
  & input {
    ${({ theme }) => theme.breakpoints.down("sm")} {
      font-size: 16px;
    }
  }
`;

const MarketCapValue = styled('span')<{ direction?: string }>`
    font-size: 48px;
    font-family: Arial;
    font-weight: bold;
    color: white;
    transition: color 0.3s ease, text-shadow 0.3s ease;
    ${({ direction }) => direction === 'up' ? `
        color: #10B981;
        text-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
    ` : direction === 'down' ? `
        color: #EF4444;
        text-shadow: 0 0 20px rgba(239, 68, 68, 0.3);
    ` : ''}
    @keyframes mcFlash {
        0% { opacity: 1; }
        50% { opacity: 0.7; }
        100% { opacity: 1; }
    }
    ${({ direction }) => direction && direction !== 'none' ? 'animation: mcFlash 0.4s ease;' : ''}
`;

const SocialLink = styled(Link)`
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: #94A3B8;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  transition: all 0.2s ease;
  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(209, 255, 26, 0.2);
    color: white;
  }
  ${({ theme }) => theme.breakpoints.down("sm")} {
    background: transparent;
    border: none;
    padding: 0;
    opacity: 0.6;
    &:hover {
      opacity: 1;
    }
  }
`;

const ChatContainer = styled(Box)`
    background: rgba(13, 13, 20, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    margin: 1.5em 0;
    max-height: 500px;
    overflow: hidden;
`

const ChatMessages = styled(Box)`
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: rgba(209, 255, 26, 0.2); border-radius: 10px; }
`

const ChatBubble = styled(Box)<{ depth?: number }>`
    display: flex;
    gap: 10px;
    padding: 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.04);
    margin-left: ${({ depth }) => Math.min((depth ?? 0) * 24, 72)}px;
    transition: background 0.2s ease;
    &:hover {
        background: rgba(255, 255, 255, 0.05);
    }
`

const ChatInputBox = styled(Box)`
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    align-items: flex-end;
    & textarea {
        flex: 1;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
        color: white;
        font-family: 'Inter', sans-serif;
        font-size: 13px;
        padding: 10px 14px;
        outline: none;
        resize: none;
        min-height: 40px;
        max-height: 100px;
        transition: border-color 0.2s ease;
        &:focus {
            border-color: rgba(209, 255, 26, 0.3);
        }
        &::placeholder {
            color: #64748B;
        }
    }
`

const ChatSendButton = styled(IconButton)`
    &.MuiIconButton-root {
        background: linear-gradient(135deg, #D3FF24, #e4ff66);
        border-radius: 10px;
        width: 40px;
        height: 40px;
        color: #0a0a0f;
        transition: all 0.2s ease;
        &:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(209, 255, 26, 0.3);
        }
        &.Mui-disabled {
            background: rgba(255, 255, 255, 0.06);
            color: rgba(255, 255, 255, 0.2);
        }
    }
`

const ReplyBadge = styled(Box)`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(209, 255, 26, 0.08);
    border: 1px solid rgba(209, 255, 26, 0.15);
    border-radius: 8px;
    font-size: 12px;
    color: #D3FF24;
    margin: 0 16px;
`

const TradeBox = styled(Box)`
  display: grid;
  grid-template-columns: 1fr 0.5fr 0.5fr 0.5fr 1fr 1fr;
  align-items: center;
  padding: 0.4em 1.2em;

  ${({ theme }) => theme.breakpoints.down("sm")} {
    grid-template-columns: 0.5fr 0.5fr 0.5fr;
    font-size: 12px;
    padding: 0.3em 0.5em;
  }
`;

const HolderBox = styled(Box)`
  background: rgba(13, 13, 20, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  list-style-position: inside;
  padding: 20px;
  color: white;
  h3 {
    font-size: 16px;
    font-family: 'Space Grotesk', 'Inter', sans-serif;
    font-weight: 600;
    line-height: 18px;
    margin: 0;
    margin-bottom: 16px;
    color: rgba(255, 255, 255, 0.9);
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    padding: 10px 0;
    gap: 8px;
    & > :first-of-type {
      flex: 0 0 1.5em;
      color: #64748B;
    }
    & > :nth-of-type(2) {
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    & > :last-child {
      flex: 0 0 auto;
      text-align: right;
      white-space: nowrap;
      color: #94A3B8;
    }
  }
  max-width: 100%;
  overflow: hidden;
  li {
    flex-wrap: wrap;
  }
  ${({ theme }) => theme.breakpoints.down("sm")} {
    font-size: 12px;
    h3 {
      font-size: 14px;
    }
    li {
      padding: 8px 0;
    }
  }
`;

const SwapBox = styled(Box)`
  background: rgba(13, 13, 20, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  width: 100%;
  max-width: 385px;
  margin: 0 auto;
  box-sizing: border-box;
  backdrop-filter: blur(12px);

  & button.medium, & button.small {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: #94A3B8;
    border-radius: 8px;
    font-family: Inter;
    font-size: 12px;
    font-weight: 500;
    padding: 6px 14px;
    display: flex;
    gap: 6px;
    text-transform: none;
    align-items: center;
    min-width: unset;
    transition: all 0.2s ease;
    &.medium:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(209, 255, 26, 0.2);
      color: white;
    }
  }

  & button.small {
    padding: 4px 8px;
  }

  &.disabled {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    filter: grayscale(0.8);
    opacity: 0.4;
    &:after {
      position: absolute;
      content: '';
      top: 0;
      left: 0;
      bottom: 0;
      right: 0;
    }
  }

  ${({ theme }) => theme.breakpoints.down("sm")} {
    padding: 16px;
    border-radius: 16px;
  }

  & button.medium, & button.small {
    ${({ theme }) => theme.breakpoints.down("sm")} {
      font-size: 10px;
      padding: 5px 10px;
    }
  }

  & button.small {
    ${({ theme }) => theme.breakpoints.down("sm")} {
      padding: 3px 6px;
    }
  }
`;

const SwapContent = ({
    amountIn, approveHandler, detailData, error, estimateAmount, ethBalance, exactInput, isLoading, swapHandler, tokenAllowance, tokenBalance, tradeType,
    setAmountIn, setExactInput, setShowSlipaggeDialog
}: any) => {
    const { chains, appKit } = useMainContext()
    const { isConnected } = useAppKitAccount()
    const { caipNetwork } = useAppKitNetwork()
    const tokenChain = useMemo(() => chains?.find(c => c.network === detailData?.network), [chains, detailData])
    const networks = ChainController.getCaipNetworks()
    const tokenNetwork = useMemo(() => {
        return networks.find(network => network.id === tokenChain?.chainId || network.chainNamespace === tokenChain?.chainId)
    }, [networks, tokenChain])
    // const { isSwitching, switchChain } = useSwitchChain()
    // const isTokenChain = useMemo(() => tokenChain?.chainId === caipNetwork?.id || tokenChain?.chainId === caipNetwork?.chainNamespace, [tokenChain, caipNetwork])

    if (!detailData || !tokenChain)
        return <Box display="flex">
            <CircularProgress />
        </Box>

    return <>
        <Box display="flex" alignContent="center" justifyContent="space-between" width="100%">
            {tradeType === "buy" && (
                <SmallButton onClick={() => {
                    setExactInput(!exactInput);
                    setAmountIn(estimateAmount);
                }}>
                    Switch to {exactInput ? detailData.tokenSymbol : tokenNetwork?.nativeCurrency.symbol}
                </SmallButton>
            )}
            <SmallButton onClick={() => setShowSlipaggeDialog(true)}>
                Trade settings
            </SmallButton>
        </Box>
        <FormControl variant="standard" sx={{ my: 3 }}>
            <CurrencyInput>
                <Typography component="span" className="balance">
                    Balance: {isConnected ? priceFormatter(tradeType === "buy" && exactInput ? ethBalance : ethers.formatUnits(tokenBalance ?? 0n)) : '0'}
                </Typography>
                <Box display="flex" alignItems="center" gap="4px">
                    <Typography color="white">{exactInput && tradeType === "buy" ? tokenNetwork?.nativeCurrency.symbol : detailData.tokenSymbol.toUpperCase()}</Typography>
                    {(exactInput && tradeType === "buy") ? (
                        <Avatar src={AssetUtil.getNetworkImage(tokenNetwork) ?? `/networks/${detailData?.network}.svg`} sx={{ width: 20, height: 20 }} />
                    ) : (
                        <TokenLogo logo={detailData.tokenImage} size="20px" style={{ width: '20px', height: '20px', borderRadius: '20px' }} />
                    )}
                    <NumericFormat
                        placeholder="0.0"
                        thousandSeparator
                        valueIsNumericString
                        value={amountIn ?? ''}
                        onValueChange={(values) => {
                            console.log(values)
                            setAmountIn(values.value)
                        }}
                    />
                </Box>
            </CurrencyInput>
        </FormControl>
        {(exactInput || tradeType === "sell") && (
            <Box display="flex" gap="4px" flexWrap="wrap">
                {/* <Button className="medium small" onClick={() => setAmountIn(undefined)}>
                                <Avatar src={resetIcon} sx={{ width: 16, height: 16 }} />
                                Reset
                            </Button> */}
                {tradeType === "buy" && (
                    <>
                        <SmallButton onClick={() => setAmountIn('0.1')}>0.1 {tokenNetwork?.nativeCurrency.symbol}</SmallButton>
                        <SmallButton onClick={() => setAmountIn('0.2')}>0.2 {tokenNetwork?.nativeCurrency.symbol}</SmallButton>
                        <SmallButton onClick={() => setAmountIn('1')}>1 {tokenNetwork?.nativeCurrency.symbol}</SmallButton>
                        <SmallButton onClick={() => setAmountIn(ethBalance?.toString() ?? '0')}>MAX</SmallButton>
                    </>
                )}
                {tradeType === "sell" && (
                    <>
                        {[25, 50, 75, 100].map(pct => (
                            <SmallButton
                                key={pct}
                                onClick={() => setAmountIn(tokenBalance ? ethers.formatEther(tokenBalance * BigInt(pct) / 100n) : '0')}
                            >
                                {pct}%
                            </SmallButton>
                        ))}
                    </>
                )}
            </Box>
        )}
        {!!error && (
            <Alert severity="error" sx={{ borderRadius: '16px' }}>{error}</Alert>
        )}
        {
            isConnected
                ? tokenNetwork?.caipNetworkId !== caipNetwork?.caipNetworkId
                    ? <Button fullWidth sx={{ borderRadius: '16px', fontSize: '20px', py: '12px', textTransform: 'none' }} onClick={() => appKit?.switchNetwork(tokenNetwork as AppKitNetwork)}>
                        Switch Network
                    </Button>
                    : tradeType === "sell" && amountIn && tokenAllowance < ethers.parseEther(amountIn)
                        ? <Button fullWidth sx={{ borderRadius: '16px', fontSize: '20px', py: '12px', textTransform: 'none' }} disabled={isLoading} onClick={() => {
                            if (!amountIn || Number(amountIn) <= 0) { toast.error('Enter an amount greater than 0'); return; }
                            approveHandler();
                        }}>
                            Approve {isLoading && <CircularProgress size={18} style={{ color: "black", marginLeft: "1em" }} />}
                        </Button>
                        : <Button fullWidth sx={{
                            borderRadius: '16px', fontSize: '20px', py: '12px', textTransform: 'none',
                            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
                            color: 'white',
                            background: tradeType === "buy"
                                ? 'linear-gradient(135deg, #10B981, #059669)'
                                : 'linear-gradient(135deg, #EF4444, #DC2626)',
                            '&:hover': {
                                background: tradeType === "buy"
                                    ? 'linear-gradient(135deg, #059669, #047857)'
                                    : 'linear-gradient(135deg, #DC2626, #B91C1C)',
                            },
                            // Button stays enabled even at 0; only dims while a swap is in flight.
                            '&.Mui-disabled': { color: 'rgba(255,255,255,0.85)' },
                        }} disabled={isLoading} onClick={() => {
                            if (!amountIn || Number(amountIn) <= 0) { toast.error('Enter an amount greater than 0'); return; }
                            if (error) { toast.error(error); return; }
                            swapHandler();
                        }}>
                            {isLoading ? <CircularProgress size={20} style={{ color: "white" }} /> : (tradeType === "buy" ? "Buy" : "Sell")}
                        </Button>
                : <Button fullWidth sx={{ borderRadius: '16px', fontSize: '20px', py: '12px', textTransform: 'none' }} onClick={() => appKit?.open()}>
                    Connect Wallet
                </Button>
        }
        {!!estimateAmount && (
            <SmallButton>
                You will receive ~{priceFormatter(estimateAmount)} {exactInput && tradeType === "buy" ? detailData.tokenSymbol.toUpperCase() : caipNetwork?.nativeCurrency.symbol}
            </SmallButton>
        )}
        {!!estimateAmount && !!amountIn && (() => {
            const inputVal = parseFloat(amountIn)
            const outputVal = parseFloat(estimateAmount)
            if (!inputVal || !outputVal || inputVal <= 0) return null
            // Approximate price impact: for sell, compare ETH-out/token-in vs current price
            // For buy, compare token-out/ETH-in vs current price
            const currentPrice = parseFloat(detailData?.tokenPrice || '0')
            if (!currentPrice) return null
            let priceImpact = 0
            if (tradeType === 'buy' && exactInput) {
                const effectivePrice = inputVal / outputVal
                priceImpact = Math.abs((effectivePrice - currentPrice) / currentPrice) * 100
            } else if (tradeType === 'sell') {
                const effectivePrice = outputVal / inputVal
                priceImpact = Math.abs((currentPrice - effectivePrice) / currentPrice) * 100
            }
            if (priceImpact <= 5) return null
            return (
                <Box sx={{
                    display: 'flex',
                    gap: 1,
                    alignItems: 'center',
                    background: priceImpact > 15 ? 'rgba(239,68,68,0.08)' : 'rgba(209,255,26,0.08)',
                    border: `1px solid ${priceImpact > 15 ? 'rgba(239,68,68,0.15)' : 'rgba(209,255,26,0.15)'}`,
                    borderRadius: '8px',
                    p: '6px 10px',
                    mt: 1,
                    width: '100%',
                    boxSizing: 'border-box',
                }}>
                    <Typography fontSize={11} color={priceImpact > 15 ? '#EF4444' : '#D3FF24'} fontWeight={500}>
                        {'\u26A0\uFE0F'} Price impact: ~{priceImpact.toFixed(1)}%
                    </Typography>
                </Box>
            )
        })()}
    </>
}

export default function Token() {
    const { address } = useAppKitAccount()
    const { isWatched, toggle: toggleWatch } = useWatchlist(address)
    const searchParams = useSearchParams()
    const network = searchParams.get('network')
    const id = searchParams.get('address')
    const { status: streamStatus } = useStreamStatus(id || undefined)
    // const [detailData, setDetailData] = React.useState<any>(null);
    const [chatList, setChatList] = React.useState<any[]>([]);
    const [chatComment, setChatComment] = React.useState('');
    const [chatReplyTo, setChatReplyTo] = React.useState<any>(null);
    const [chatLoading, setChatLoading] = React.useState(false);
    const [chatSending, setChatSending] = React.useState(false);
    // const [tradeData, setTradeData] = React.useState<any>([]);
    // const [king, setKing] = React.useState<any>()
    // const [value, setValue] = React.useState('1');
    // const [holders, setHolders] = React.useState([]);
    const [amountIn, setAmountIn] = React.useState<string>();
    // const [type, setType] = React.useState("BUY");
    const [estimateAmount, setEstimateAmount] = React.useState<string>();
    const [modal, showModal] = React.useState<string>();
    // const [maxBuyPercent, setMaxBuyPercent] = React.useState(0n);
    // const [maxAmount, setMaxAmount] = React.useState('0');
    // const [launched, setLaunched] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(false);
    const [mode, setMode] = React.useState('trades');
    const [tradeType, setTradeType] = React.useState('buy');
    const [exactInput, setExactInput] = React.useState(true);
    // const [candleList, setCandleList] = React.useState<any[]>()
    // const [poolInfo, setPoolInfo] = React.useState<any>()
    const [errorCustom, setError] = React.useState<string>()
    const selectedDex = "Forge Finance"; // useMemo(() => dexList?.[0], [dexList])

    // const [marketCap, setMarketCap] = useState<number>()
    // const [now, setNow] = useState(0)
    const [pageOfTrades, setPageOfTrades] = useState(1)

    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    // const [signer, setSigner] = React.useState(null as any);
    // const [plsBalance, setPlsBalance] = React.useState(0n);
    // const [tokenBalance, setTokenBalance] = React.useState(0n);
    // const [tokenAllowance, setTokenAllowance] = React.useState(0n);
    const pageSize = isMobile ? 5 : 10
    const [showSlipaggeDialog, setShowSlipaggeDialog] = React.useState(false);
    const [slippage, setSlippage] = React.useState(0.1);

    // Check if this is a Solana token
    const isSolanaToken = network === 'solana';
    // console.log(isSolanaToken)

    const { chains } = useMainContext()
    const { userInfo } = useUserInfo()
    const { tokenInfo, reload: reloadTokenInfo, error: tokenInfoError, isLoading: tokenInfoLoading } = useTokenInfo(id as string, network as string, pageOfTrades, pageSize)
    const ethBalance = useMemo(() => userInfo?.balance ?? 0, [userInfo])
    const { balance: tokenBalance, allowance: tokenAllowance, curveBalance: lpBalance } = useMemo(() => tokenInfo ?? { balance: 0n, allowance: 0n, curveBalance: 0n }, [tokenInfo])
    const poolInfo = useMemo(() => tokenInfo?.poolInfo, [tokenInfo])
    const {
        tokenContract,
        tokenDetails: detailData,
        trades: tradeData,
        tradesCount,
        holdersDetails: holders
    } = useMemo(() => tokenInfo ?? {}, [tokenInfo])

    const tokenChain = useMemo(() => chains?.find(c => c.network === network), [chains, network])
    const networks = ChainController.getCaipNetworks()
    const tokenNetwork = useMemo(() => {
        return networks.find(network => network.id === tokenChain?.chainId || network.chainNamespace === tokenChain?.chainId)
    }, [networks, tokenChain])
    const handlers = useHandlers(tokenNetwork)
    const topHolderPercent = useMemo(() => {
        if (!holders?.length || !tokenChain?.totalSupply) return 0
        const sorted = [...holders].sort((a: any, b: any) => b.tokenAmount - a.tokenAmount)
        return sorted[0].tokenAmount / tokenChain.totalSupply * 100
    }, [holders, tokenChain])
    const { walletProvider: evmProvider } = useAppKitProvider<EVMProvider>("eip155")
    const chatMessagesRef = useRef<HTMLDivElement>(null)

    // Chat: fetch messages
    const fetchChats = useCallback(async () => {
        if (!id || !network) return
        setChatLoading(true)
        try {
            const { data } = await axios.post(`${API_ENDPOINT}/chats`, { tokenAddress: id, network })
            setChatList(data)
        } catch (err) {
            console.error('Failed to fetch chats:', err)
        } finally {
            setChatLoading(false)
        }
    }, [id, network])

    // Chat: load on tab switch
    useEffect(() => {
        if (mode === 'chat') {
            fetchChats()
        }
    }, [mode, fetchChats])

    // Chat: auto-scroll to bottom
    useEffect(() => {
        if (chatMessagesRef.current) {
            chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
        }
    }, [chatList])

    // Chat: build threaded structure
    const threadedChats = useMemo(() => {
        if (!chatList.length) return []
        return chatList.map(chat => {
            const codeParts = (chat.code || '').split('#')
            return { ...chat, depth: codeParts.length - 1 }
        })
    }, [chatList])

    // Chat: send message
    const sendChat = useCallback(async () => {
        if (!chatComment.trim() || !id || !network || !address || !evmProvider) return
        if (chatComment.length > 1000) {
            toast.error('Message must be 1000 characters or fewer')
            return
        }
        setChatSending(true)
        try {
            const provider = new BrowserProvider(evmProvider)
            const signer = await provider.getSigner()
            const msg = `Post comment on ${id}\n${Date.now()}`
            const signature = await signer.signMessage(msg)

            await axios.post(`${API_ENDPOINT}/chats/reply`, {
                tokenAddress: id,
                replyAddress: address,
                comment: chatComment.trim(),
                network,
                replyId: chatReplyTo?.id,
                signature,
                msg
            })
            setChatComment('')
            setChatReplyTo(null)
            await fetchChats()
        } catch (err: any) {
            const msg = err?.response?.data?.error || err?.message || 'Failed to send message'
            toast.error(msg)
        } finally {
            setChatSending(false)
        }
    }, [chatComment, id, network, address, evmProvider, chatReplyTo])

    const marketCap = useMemo(() => Number(detailData?.marketcap ?? 0), [detailData])
    const prevMarketCap = useRef(0)
    const [mcDirection, setMcDirection] = useState<'up' | 'down' | 'none'>('none')

    useEffect(() => {
        if (marketCap !== prevMarketCap.current && prevMarketCap.current > 0) {
            const dir = marketCap > prevMarketCap.current ? 'up' : 'down'
            setMcDirection(dir)
            const timer = setTimeout(() => setMcDirection('none'), 2000)
            return () => clearTimeout(timer)
        }
        prevMarketCap.current = marketCap
    }, [marketCap])

    const pagesOfTrades = useMemo(() => tradesCount ? Math.floor(tradesCount / pageSize) + (tradesCount % pageSize === 0 ? 0 : 1) : 0, [pageSize, tradesCount])

    useEffect(() => {
        if (isMobile) {
            window.scrollTo(0, 0);
        }
    }, [isMobile]);

    useEffect(() => {
        const _slippage = localStorage.getItem('slippage');
        if (_slippage) {
            setSlippage(parseFloat(_slippage));
        }
    }, [slippage]);

    const error = useMemo(() => {
        return errorCustom
    }, [errorCustom])

    // useEffect(() => {
    //     if (isWrongChain)
    //         switchNetwork(DEFAULT_CHAIN_ID)
    // }, [isWrongChain, switchNetwork])

    const launched = useMemo(() => poolInfo?.launched || !!detailData?.launchedAt, [poolInfo, detailData])

    // const routerContract = useMemo(() => {
    //     if (selectedDex === undefined)
    //         return undefined
    //     // return new ethers.Contract(DEX_ROUTERS[selectedDex], routerABI, provider)
    //     return new ethers.Contract(DEFAULT_CONTRACT_ADDRESS, abiRouter, provider)
    // }, [selectedDex])

    useEffect(() => {
        async function estimate() {
            if (detailData?.tokenAddress && amountIn) {
                if (tradeType === "buy") {
                    return handlers?.quoteBuy(detailData.tokenAddress, amountIn, exactInput)
                } else if (tradeType === "sell") {
                    return handlers?.quoteSell(detailData.tokenAddress, amountIn)
                }
            }
            return undefined
        }
        estimate().then((amount) => {
            setEstimateAmount(amount as string | undefined)
            setError(undefined)
        }).catch(ex => {
            setEstimateAmount(undefined)
            setError(ex.message)
        })
    }, [amountIn, tradeType, exactInput, detailData])

    // const [estimateAmount, error] = useMemo(() => {
    //     try {
    //         if (poolInfo && amountIn) {
    //             if (launched) {
    //                 if (selectedDex === undefined || !routerContract)
    //                     throw Error("Already launched!")
    //                 if (tradeType === "buy") {
    //                     if (exactInput) {
    //                         const amountInWei = ethers.parseEther(amountIn)
    //                         if (amountInWei > ethBalance)
    //                             throw Error("Insufficient ${tokenNetwork?.nativeCurrency.symbol} balance")
    //                         routerContract.getAmountsOut(amountInWei, [WPLS, detailData.tokenAddress]).then(amountsOut => {
    //                             setEstimateAmount(ethers.formatEther(amountsOut[1]))
    //                         }).catch(() => { })
    //                     } else {
    //                         const amountOutWei = ethers.parseEther(amountIn)
    //                         routerContract.getAmountsIn(amountOutWei, [WPLS, detailData.tokenAddress]).then(amountsIn => {
    //                             if (amountsIn[0] > ethBalance)
    //                                 throw Error("Insufficient ${tokenNetwork?.nativeCurrency.symbol} balance")
    //                             setEstimateAmount(ethers.formatEther(amountsIn[0]))
    //                         }).catch(() => { })
    //                     }
    //                 } else if (tradeType === "sell") {
    //                     const amountInWei = ethers.parseEther(amountIn)
    //                     if (amountInWei > tokenBalance)
    //                         throw Error(`Insufficient ${detailData?.tokenSymbol ?? 'Token'} balance.`)
    //                     routerContract.getAmountsOut(amountInWei, [detailData.tokenAddress, WPLS]).then(amountsOut => {
    //                         setEstimateAmount(ethers.formatEther(amountsOut[1]))
    //                     }).catch(() => { })
    //                 }
    //             } else {
    //                 if (tradeType === "buy") {
    //                     if (exactInput) {
    //                         const amountInWei = ethers.parseEther(amountIn) * 97n / 100n
    //                         // if (amountInWei > poolInfo.virtualEthReserve * maxBuyPercent / 10000n)
    //                         //     throw Error(`Maximum: ${priceFormatter(ethers.formatEther(poolInfo.virtualEthReserve * maxBuyPercent / 10000n), 2)} ${tokenNetwork?.nativeCurrency.symbol}`)
    //                         if (amountInWei > ethBalance)
    //                             throw Error("Insufficient ${tokenNetwork?.nativeCurrency.symbol} balance")
    //                         setEstimateAmount(ethers.formatEther(amountInWei * poolInfo.virtualTokenReserve / (poolInfo.virtualEthReserve + amountInWei)))
    //                     } else {
    //                         const amountOutWei = ethers.parseEther(amountIn)
    //                         if (amountOutWei >= poolInfo.virtualTokenReserve)
    //                             throw Error(`Amount exceeds current reserves.`)
    //                         const amountInWei = amountOutWei * poolInfo.virtualEthReserve / (poolInfo.virtualTokenReserve - amountOutWei) + 1n
    //                         // if (estAmount * 97n / 100n > poolInfo.virtualEthReserve * maxBuyPercent / 10000n)
    //                         //     throw Error(`Maximum: ${priceFormatter(ethers.formatEther(poolInfo.virtualTokenReserve * maxBuyPercent / 10000n), 2)} ${detailData.tokenSymbol}`)
    //                         setEstimateAmount(ethers.formatEther(amountInWei * 100n / 97n))
    //                         if (amountInWei * 100n / 97n > ethBalance)
    //                             throw Error(`Insufficient ${tokenNetwork?.nativeCurrency.symbol} balance.`)
    //                     }
    //                 } else if (tradeType === "sell") {
    //                     const amountInWei = ethers.parseEther(amountIn)
    //                     // if (amountInWei > poolInfo.virtualTokenReserve)
    //                     //     throw Error("Amount exceeds current reserves.")
    //                     if (amountInWei > tokenBalance)
    //                         throw Error(`Insufficient ${detailData?.tokenSymbol ?? 'Token'} balance.`)
    //                     setEstimateAmount(ethers.formatEther(amountInWei * poolInfo.virtualEthReserve / (poolInfo.virtualTokenReserve + amountInWei) * 97n / 100n))
    //                 }
    //             }
    //         } else
    //             setEstimateAmount(undefined)
    //         setError(undefined)
    //     } catch (err: any) {
    //         setEstimateAmount(undefined)
    //         setError(err.message)
    //     }
    // }, [])

    const approveHandler = useCallback(async () => {
        setIsLoading(true);
        try {
            if (!detailData || !address || !handlers?.approve)
                throw Error("Connect wallet");
            const tx = await handlers.approve(detailData.tokenAddress)
            // Wait via the read RPC (reliable) rather than the wallet provider,
            // which can throw ERR_NETWORK while polling the receipt.
            if (tx?.hash && tokenChain?.rpcUrl) {
                await new ethers.JsonRpcProvider(tokenChain.rpcUrl).waitForTransaction(tx.hash).catch(() => { })
            } else if (tx?.wait) {
                await tx.wait().catch(() => { })
            }
            toast.success("Successfully approved!");
            setIsLoading(false);
        } catch (error: any) {
            setIsLoading(false);
            const messageError = error?.shortMessage || error?.data?.message;
            toast.error(messageError);
        }
    }, [detailData, tradeType, amountIn, address, tokenContract, tokenChain])

    const showSuccessToast = useCallback((txHash: string, type?: string) => {
        const link = `${tokenChain?.explorerUrl}/tx/${txHash}`
        const shortHash = `${txHash.slice(0, 6)}...${txHash.slice(-6)}`
        toast.success(
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>{type === 'sell' ? 'Sell' : 'Buy'} successful</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#64748B', fontSize: '12px', fontFamily: 'monospace' }}>TX: {shortHash}</span>
                    <a style={{ textDecoration: 'none', color: '#D3FF24', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '3px' }} target="_blank" rel="noreferrer" href={link}>View <LinkIcon sx={{ fontSize: 12 }} /></a>
                </div>
            </div>,
            { duration: 8000 }
        );
    }, [tokenChain])

    const swapHandler = useCallback(async () => {
        setIsLoading(true);
        try {
            if (!address || !handlers)
                throw Error("Connect wallet");
            const _slippage = BigInt(Math.floor(slippage * 100));
            let tx;
            if (tradeType === "buy") {
                tx = await handlers.buyToken(detailData.tokenAddress, amountIn ?? '0', _slippage, exactInput)
                playBuySound()
                showSuccessToast(tx.hash, 'buy')
            } else {
                tx = await handlers.sellToken(detailData.tokenAddress, amountIn ?? '0', _slippage)
                playSellSound()
                showSuccessToast(tx.hash, 'sell')
            }
            // Wait for tx to be mined so backend can process the event. Use the
            // read RPC (reliable) instead of the wallet provider, which can throw
            // ERR_NETWORK while polling eth_getTransactionReceipt.
            if (tx?.hash && tokenChain?.rpcUrl) {
                await new ethers.JsonRpcProvider(tokenChain.rpcUrl).waitForTransaction(tx.hash).catch(() => { })
            } else if (tx?.wait) {
                await tx.wait().catch(() => { })
            }
            setAmountIn(undefined)
            setIsLoading(false);
            // Small delay to let backend process the block event
            setTimeout(() => reloadTokenInfo(), 1500)
        } catch (error: any) {
            setIsLoading(false);
            console.error('Swap error:', error);
            const msg = error?.shortMessage || error?.data?.message || error?.message || 'Transaction failed';
            // Detect nonce issues (common after Anvil/node restart)
            if (msg.toLowerCase().includes('nonce') || msg.toLowerCase().includes('replacement')) {
                toast.error('Nonce mismatch — reset your wallet account (Settings > Advanced > Reset Account)');
            } else {
                toast.error(msg);
            }
        }
    }, [detailData, amountIn, address, slippage, handlers, showSuccessToast, reloadTokenInfo, tradeType, exactInput, tokenChain])

    const parseLink = (domain: string, link?: string) => {
        if (!link)
            return undefined
        if (domain) {
            if (link.startsWith(`https://${domain}/`))
                return link
            if (link.startsWith(`${domain}/`) || link.startsWith(`/${domain}/`))
                return `https://${link}`
            return `https://${domain}/${link}`
        } else {
            if (link.startsWith(`https://`))
                return link
            return `https://${link}`
        }
    }

    const telegramLink = useMemo(() => {
        return parseLink('t.me', detailData?.telegramLink)
    }, [detailData])

    const twitterLink = useMemo(() => {
        return parseLink('x.com', detailData?.twitterLink)
    }, [detailData])

    const webLink = useMemo(() => {
        return parseLink('', detailData?.webLink)
    }, [detailData])

    const pool = useMemo(() => {
        if (!tokenChain || !detailData)
            return undefined

        if (isSolanaToken) {
            return {
                name: "meteora"
            }
        }

        const poolFields = tokenChain.pools[detailData.poolType - 1].split(':')
        return {
            name: poolFields[0], version: poolFields[1]
        }
    }, [detailData, tokenChain])

    const isDirectLaunch = useMemo(() => {
        return pool?.name === 'direct'
    }, [pool])

    // const dexList: DexKey[] | undefined = useMemo(() => {
    //     if (detailData && detailData.pairAddresses)
    //         return Object.keys(detailData.pairAddresses) as DexKey[]
    //     if (poolInfo?.bitmapRouters) {
    //         const routers: DexKey[] = []
    //         const ROUTERS: DexKey[] = ["9INCH", "9mm", "PulseX"]
    //         for (const i in ROUTERS) {
    //             if ((Number(poolInfo.bitmapRouters) >> Number(i)) & 0x1)
    //                 routers.push(ROUTERS[i])
    //         }
    //         if (routers.length)
    //             return routers
    //     }
    //     return undefined
    // }, [detailData, poolInfo])

    // A token that isn't in the backend yet (just deployed and awaiting indexing,
    // or a bad address) makes the detail fetch 404. Show a clear state with retry
    // instead of spinning forever. Once indexed, detailData arrives and the full
    // page renders normally.
    if (!detailData) {
        return (
            <PageBox display="flex" flexDirection="column" alignItems="center" justifyContent="center" gap="1em" minHeight="60vh" pt={6}>
                {tokenInfoError && !tokenInfoLoading ? (
                    <>
                        <Typography color="white" fontSize={20} fontWeight="bold">Token not found or still indexing</Typography>
                        <Typography color="#AAA" fontSize={14} textAlign="center" maxWidth={420}>
                            If you just created this token it can take a few seconds to be indexed. This page refreshes automatically.
                        </Typography>
                        <Button onClick={() => reloadTokenInfo()} sx={{ borderRadius: '16px', textTransform: 'none', color: 'black', bgcolor: '#D3FF24', px: 3, py: 1 }}>
                            Retry
                        </Button>
                    </>
                ) : (
                    <CircularProgress sx={{ color: '#D3FF24' }} />
                )}
            </PageBox>
        )
    }

    return (
        <PageBox display="flex" flexDirection="column" justifyContent="space-between" gap="1.5em" maxWidth="100%" overflow="hidden" pt={6}>
            {/* {!!detailData?.tokenBanner && (
                <Banner src={`${IPFS_GATEWAY_URL}/${detailData.tokenBanner}`} />
            )} */}
            <div style={{ flex: 1, position: 'relative' }}>
                <Box display="flex" flexDirection="column" justifyContent="space-between" gap="0.5em">
                    <Box display="flex" gap="8px" alignItems="center">
                        <img src={`/networks/${detailData?.network}.svg`} height={isMobile ? 18 : 24} alt="" />
                        <Typography fontSize={{ md: 24, sm: 18, xs: 16 }} fontFamily="Arial" fontWeight="bold" color="white">{detailData?.tokenName}</Typography>
                        <Typography fontSize={{ md: 24, sm: 18, xs: 16 }} fontFamily="Arial" fontWeight="bold" color="#AAA">({detailData?.tokenSymbol})</Typography>
                        <Typography fontSize={12} color="#AAA" ml={{ md: "1em", sm: "auto", xs: "auto" }}>{detailData?.tokenAddress?.slice(0, 6)}...{detailData?.tokenAddress?.slice(-4)}</Typography>
                        <IconButton sx={{ width: 'fit-content' }} onClick={() => {
                            copy(detailData?.tokenAddress)
                            toast.success('Contract address copied!', { duration: 2000 })
                        }}>
                            <CopyIcon sx={{ color: "#9E9E9E", width: 14, height: 14 }} />
                        </IconButton>
                        {address && detailData?.tokenAddress && (
                            <IconButton sx={{ width: 'fit-content' }} title="Add to watchlist" onClick={() => toggleWatch(detailData.tokenAddress, detailData.network)}>
                                {isWatched(detailData.tokenAddress)
                                    ? <StarIcon sx={{ color: '#e4ff66', width: 16, height: 16 }} />
                                    : <StarBorderIcon sx={{ color: '#9E9E9E', width: 16, height: 16 }} />}
                            </IconButton>
                        )}
                        <IconButton sx={{ width: 'fit-content' }} onClick={() => {
                            const url = window.location.href
                            if (navigator.share) {
                                navigator.share({ title: `${detailData?.tokenName} (${detailData?.tokenSymbol})`, url })
                            } else {
                                copy(url)
                                toast.success('Token link copied!', { duration: 2000 })
                            }
                        }}>
                            <LinkIcon sx={{ color: "#9E9E9E", width: 14, height: 14 }} />
                        </IconButton>
                    </Box>
                    <Box display="flex" gap="8px" alignItems="center" width="100%" position="relative">
                        <TokenLogo logo={detailData?.tokenImage} size={isMobile ? "75px" : "120px"} />
                        {
                            streamStatus?.isLive &&
                            <Box onClick={() => setMode("live")}
                                sx={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: '4px', px: '8px', py: '3px', borderRadius: '8px', background: 'rgba(239,68,68,0.9)', cursor: 'pointer', zIndex: 2 }}>
                                <Box sx={{ width: 7, height: 7, borderRadius: '50%', background: 'white' }} />
                                <Typography fontSize={11} fontWeight={800} color="white">LIVE {streamStatus.viewers > 0 ? `· ${streamStatus.viewers}` : ''}</Typography>
                            </Box>
                        }
                        {
                            !isMobile &&
                            <Box>
                                <Box display="flex" gap="8px" alignItems="baseline" position="relative" width="fit-content">
                                    <MarketCapValue direction={mcDirection}>
                                        $<CountUp
                                            start={prevMarketCap.current || 0}
                                            end={marketCap}
                                            duration={1.2}
                                            decimals={2}
                                            separator=","
                                            preserveValue
                                        />
                                    </MarketCapValue>
                                    <Typography fontSize={12} color="rgba(255,255,255,0.6)">Market cap</Typography>
                                    <Box
                                        position="absolute"
                                        right={0} top={12}
                                        display="flex" justifyContent="center" alignItems="center" gap="4px"
                                    // title={`When marcket cap reaches at $${priceFormatter(tokenChain?.targetMarketCap, 2)}, all the liquidity will be listed on Uniswap`}
                                    >
                                        <Avatar src={`/pools/${pool?.name}.png`} sx={{ width: 20, height: 20 }} alt="unitswap" />
                                        {
                                            !!pool?.version &&
                                            <Typography fontSize={12} color="white">{pool.version}</Typography>
                                        }
                                    </Box>
                                </Box>
                                <Box display="flex" gap="8px" alignItems="baseline">
                                    <Typography fontSize={14} color={Number(detailData?.price15m ?? 0) >= 0 ? "#10B981" : "#D3FF24"}>
                                        {Number(detailData?.price15m ?? 0) >= 0 ? '+' : '-'}${priceFormatter(Math.abs(Number(detailData?.price15m ?? 0)))} ({Number(detailData?.priceChange15m).toFixed(2)}%)
                                    </Typography>
                                    <Typography fontSize={12} color="white">Past 15m</Typography>
                                </Box>
                                <Box display="flex" gap="8px">
                                    <StatsBox>
                                        <Typography fontSize={12} color="#9E9E9E">Volume:</Typography>
                                        <Typography fontSize={12} color="white">${priceFormatter(detailData?.volume ?? 0, 2, true, true)}</Typography>
                                    </StatsBox>
                                    {
                                        !!detailData?.creationTime &&
                                        <StatsBox>
                                            <Typography fontSize={12} color="#9E9E9E">Created At:</Typography>
                                            <Typography fontSize={12} color="white">
                                                {
                                                    Date.now() - new Date(detailData.creationTime).getTime() < 3600000
                                                        ? <TimeDiff time={new Date(detailData.creationTime)} postfix="ago" />
                                                        : new Date(detailData.creationTime).toLocaleString('en-US', { month: 'short', year: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                                                }
                                            </Typography>
                                        </StatsBox>
                                    }
                                </Box>
                            </Box>
                        }
                        <Box alignSelf={{ md: "flex-end", sm: "flex-start", xs: "flex-start" }} flex={1} ml="auto" display="flex" flexDirection="column" alignItems="flex-end" gap={{ xs: '4px', sm: '4px', md: '8px' }}>
                            {
                                launched &&
                                <Box sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'flex-end',
                                    gap: 1,
                                    p: 2,
                                    borderRadius: '12px',
                                    background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(5,150,105,0.04))',
                                    border: '1px solid rgba(16,185,129,0.2)',
                                    maxWidth: '400px',
                                }}>
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <Typography fontSize={16} fontWeight={700} color="#10B981" fontFamily="'Space Grotesk', sans-serif">
                                            🎓 Graduated
                                        </Typography>
                                        <span className="badge-graduated" style={{ fontSize: 11 }}>LIVE ON DEX</span>
                                    </Box>
                                    <Typography fontSize={12} color="#94A3B8" textAlign="right" lineHeight={1.4}>
                                        This token has graduated from the bonding curve and is now trading on a decentralized exchange.
                                    </Typography>
                                    {detailData?.pairAddress && (
                                        <Link
                                            href={`${tokenChain?.explorerUrl}/address/${detailData.pairAddress}`}
                                            target="_blank"
                                            style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, color: '#10B981', fontSize: 12, fontWeight: 600 }}
                                        >
                                            View LP pair <LinkIcon sx={{ fontSize: 14 }} />
                                        </Link>
                                    )}
                                </Box>
                            }
                            {
                                !launched &&
                                <>
                                    <Typography fontSize={{ xs: 10, sm: 10, md: 14 }} color="#DDD">Progress ({Math.min(99.99, Number(detailData?.progress ?? 0)).toFixed(2)}%)</Typography>
                                    <Progress value={Math.min(100, Number(detailData?.progress ?? 0))} />
                                    <Typography fontSize={11} color="#64748B" mt={0.5} lineHeight={1.4} textAlign="right" maxWidth="400px">
                                        When the market cap reaches the target, liquidity will be automatically added to the DEX and the token will be freely tradeable.
                                    </Typography>
                                    <Box display="flex" alignItems="center" gap="8px">
                                        <svg width="17" height="16" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M5.05762 13.3333H11.7243" stroke="#C1C1C1" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M7.05762 13.3333C10.7243 11.6667 7.59095 9.06666 9.05762 6.66666" stroke="#C1C1C1" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M6.72428 6.26668C7.45762 6.80001 7.92428 7.73334 8.25762 8.73334C6.92428 9.00001 5.92428 9.00001 5.05762 8.53334C4.25762 8.13334 3.52428 7.26668 3.05762 5.73334C4.92428 5.40001 5.99095 5.73334 6.72428 6.26668Z" stroke="#C1C1C1" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M9.79097 3.99999C9.28269 4.79436 9.02702 5.72409 9.05764 6.66666C10.3243 6.59999 11.2576 6.26666 11.9243 5.73332C12.591 5.06666 12.991 4.19999 13.0576 2.66666C11.2576 2.73332 10.391 3.33332 9.79097 3.99999Z" stroke="#C1C1C1" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                        <Typography fontSize={{ xs: 10, sm: 10, md: 14 }} color="#DDD">1d liquidity: {priceFormatter(detailData?.liquidity1d ?? 0)} {tokenNetwork?.nativeCurrency.symbol}</Typography>
                                    </Box>
                                    <Box display="flex" alignItems="center" justifyContent="center" gap="8px" mt={1}>
                                        {!!webLink && (
                                            <SocialLink href={webLink} target="_blank">
                                                <img src={WebsiteIcon} width={12} height={12} alt="website" />
                                                {!isMobile && 'Website'}
                                            </SocialLink>
                                        )}
                                        {!!twitterLink && (
                                            <SocialLink href={twitterLink} target="_blank">
                                                <img src={TwitterIcon} width={12} height={12} alt="twitter" />
                                                {!isMobile && 'Twitter'}
                                            </SocialLink>
                                        )}
                                        {!!telegramLink && (
                                            <SocialLink href={telegramLink} target="_blank">
                                                <img src={TelegramIcon} width={12} height={12} alt="telegram" />
                                                {!isMobile && 'Telegram'}
                                            </SocialLink>
                                        )}
                                    </Box>
                                </>
                            }
                        </Box>
                    </Box>
                </Box>
                {
                    isMobile &&
                    <Box mt={1}>
                        <Box display="flex" gap="8px" alignItems="baseline">
                            <MarketCapValue direction={mcDirection} style={{ fontSize: 32 }}>
                                $<CountUp
                                    start={prevMarketCap.current || 0}
                                    end={marketCap}
                                    duration={1.2}
                                    decimals={2}
                                    separator=","
                                    preserveValue
                                />
                            </MarketCapValue>
                            <Typography fontSize={12} color="rgba(255,255,255,0.6)">Market cap</Typography>
                        </Box>
                        <Box display="flex" gap="8px" alignItems="baseline">
                            <Typography fontSize={14} color={Number(detailData?.priceChange15m ?? 0) >= 0 ? "#10B981" : "#EF4444"}>
                                {Number(detailData?.price ?? 0) >= Number(detailData?.price15m ?? 0) ? '+' : '-'}${priceFormatter(Number(detailData?.price15m ?? 0) - Number(detailData?.price15MinAgo ?? 0))} ({Number(detailData?.priceChange15m).toFixed(2)}%)
                            </Typography>
                            <Typography fontSize={12} color="white">Past 15m</Typography>
                        </Box>
                        <Box display="flex" flexDirection="column" alignItems="stretch" gap="1px">
                            <StatsBox>
                                <Typography fontSize={12} color="#9E9E9E">Volume:</Typography>
                                <Typography fontSize={12} color="white">${priceFormatter(detailData?.volume ?? 0, 2, true, true)}</Typography>
                            </StatsBox>
                            {
                                !!detailData?.creationTime &&
                                <StatsBox>
                                    <Typography fontSize={12} color="#9E9E9E">Created At:</Typography>
                                    <Typography fontSize={12} color="white">
                                        {
                                            Date.now() - new Date(detailData.creationTime).getTime() < 3600000
                                                ? <TimeDiff time={new Date(detailData.creationTime)} postfix="ago" />
                                                : new Date(detailData.creationTime).toLocaleString('en-US', { month: 'short', year: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                                        }
                                    </Typography>
                                </StatsBox>
                            }
                            <StatsBox>
                                <Typography fontSize={12} color="#9E9E9E">{launched ? 'Trading on:' : 'Will be deposited to:'}</Typography>
                                <Typography fontSize={12} color={launched ? '#10B981' : 'white'} textTransform="capitalize">
                                    {launched ? '🎓 ' : ''}{pool?.name} {pool?.version} pool
                                </Typography>
                            </StatsBox>
                        </Box>
                        {launched && (
                            <Box sx={{
                                mt: 1,
                                p: 1.5,
                                borderRadius: '10px',
                                background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(5,150,105,0.04))',
                                border: '1px solid rgba(16,185,129,0.2)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                            }}>
                                <Typography fontSize={13} fontWeight={600} color="#10B981">
                                    🎓 Graduated to DEX
                                </Typography>
                            </Box>
                        )}
                    </Box>
                }
                <Box display="flex" justifyContent="space-between" gap="2em" flexDirection={{ md: 'row', sm: 'column', xs: 'column' }} mt={2} mb={4}>
                    <Box flex="1" display="flex" flexDirection="column">
                        {/* {
                            launched &&
                            <Box display="flex" gap="1em" flexDirection={{ xs: 'column', sm: 'row' }} justifyContent="space-between" mb="2em" alignItems={{ sm: "flex-end", xs: "stretch" }}>
                                <Toggle style={{ width: "auto" }}>
                                    <div className={selectedDex === undefined ? "active" : ""} onClick={() => selectDex(undefined)}>CoinQuest</div>
                                    {
                                        dexList?.map((dex: DexKey) =>
                                            <div className={selectedDex === dex ? "active" : ""} onClick={() => selectDex(dex)}>{dex}</div>
                                        )
                                    }
                                </Toggle>
                                {
                                    !!selectedDex &&
                                    <Link href={`${DEX_LINKS[selectedDex]}${id}`} target="_blank" style={{ textDecoration: 'none' }}>
                                        <Button variant="text" color="warning" sx={{ borderColor: 'transparent', display: "flex", alignItems: "center", justifyContent: "center", height: 'fit-content', width: '100%' }}>
                                            Trade {detailData?.tokenSymbol} on {selectedDex}
                                            <LinkIcon sx={{ color: "#bce128", height: 16 }} />
                                        </Button>
                                    </Link>
                                }
                            </Box>
                        } */}
                        {
                            isDirectLaunch
                                ? <Box sx={{ width: '100%', height: '465px', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                    <iframe
                                        src={`https://www.geckoterminal.com/robinhood/tokens/${id}?embed=1&info=0&swaps=0&chart_type=market_cap&resolution=1d&bg_color=111827`}
                                        style={{ width: '100%', height: '100%', border: 'none' }}
                                        allow="clipboard-write"
                                        loading="lazy"
                                    />
                                </Box>
                                : <TVChartContainerAdvanced token={id} network={network} dex={selectedDex} />
                        }
                        <Box mt="2em">
                            <Box display="flex" justifyContent="space-between" flexDirection={{ xs: 'column', sm: 'row' }}>
                                <Toggle inner="true">
                                    <div className={mode === "trades" ? "active" : ""} onClick={() => setMode("trades")}>Trades</div>
                                    <div className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>Chat</div>
                                    <div className={mode === "info" ? "active" : ""} onClick={() => setMode("info")}>Info</div>
                                    <div className={mode === "analytics" ? "active" : ""} onClick={() => setMode("analytics")}>Analytics</div>
                                    <div className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>{streamStatus?.isLive ? '🔴 Live' : 'Live'}</div>
                                    {
                                        isMobile &&
                                        <div className={mode === "holders" ? "active" : ""} onClick={() => setMode("holders")}>Holders</div>
                                    }
                                </Toggle>
                            </Box>
                            {mode === "trades" && (
                                <Box mb="1.5em">
                                    <Box display="flex" flexDirection="column" my="1.5em" borderRadius="16px" overflow="hidden" bgcolor="rgba(13, 13, 20, 0.6)" border="1px solid rgba(255, 255, 255, 0.05)">
                                        <TradeBox sx={{ pt: 3, pb: 2 }}>
                                            <Typography color="white" fontSize={14} fontWeight="bold" display={{ sm: 'block', xs: 'none' }}>Date</Typography>
                                            <Typography color="white" fontSize={14} fontWeight="bold">Type</Typography>
                                            <Typography color="white" fontSize={14} fontWeight="bold">{tokenNetwork?.nativeCurrency.symbol}</Typography>
                                            <Typography color="white" fontSize={14} fontWeight="bold">{detailData?.tokenSymbol}</Typography>
                                            <Typography color="white" fontSize={14} fontWeight="bold" display={{ sm: 'block', xs: 'none' }}>Trader</Typography>
                                            <Typography color="white" fontSize={14} fontWeight="bold">Transaction</Typography>
                                        </TradeBox>
                                        {
                                            tradeData?.map((trade: any) => (
                                                <Fragment key={trade.txHash}>
                                                    <Divider />
                                                    <TradeBox sx={{ py: 2, color: trade.type === "BUY" ? "#10B981" : "#EF4444" }}>
                                                        <Typography color="inherit" fontSize="small" display={{ sm: 'block', xs: 'none' }}>
                                                            {
                                                                Date.now() - new Date(trade.date * 1000).getTime() < 3600000
                                                                    ? <TimeDiff time={new Date(trade.date * 1000)} postfix="ago" />
                                                                    : new Date(trade.date * 1000).toLocaleString('en-US', { month: 'short', year: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                                                            }
                                                        </Typography>
                                                        <Typography color="inherit" fontSize="small">{trade.type}</Typography>
                                                        <Typography color="inherit" fontSize="small">{priceFormatter(trade.ethAmount, 4, true, true)}</Typography>
                                                        {/* <Typography color="inherit" fontSize="small">{priceFormatter(trade.tokenAmount * trade.tokenPrice, 2, true, true)}</Typography> */}
                                                        <Typography color="inherit" fontSize="small">{priceFormatter(trade.tokenAmount, 4, true, true)}</Typography>
                                                        <Box display={{ sm: 'flex', xs: 'none' }} alignItems="center" gap="6px">
                                                            <UserAvatar user={{ username: trade.swapperUsername, avatar: trade.swapperAvatar, address: trade.swapperAddress }} address={trade.swapperAddress} size={18} mr="0" />
                                                            <UserName user={{ username: trade.swapperUsername, avatar: trade.swapperAvatar, address: trade.swapperAddress }} address={trade.swapperAddress} color={trade.type === "BUY" ? "#10B981" : "#EF4444"} size={18} />
                                                        </Box>
                                                        <Box display={{ sm: 'block', xs: 'none' }}>
                                                            <Link style={{ textDecoration: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} href={`${tokenChain?.explorerUrl}/tx/${trade.txHash}`} target="_blank">
                                                                <Typography color={trade.type === "BUY" ? "#10B981" : "#EF4444"} fontSize="small">{trade.txHash.slice(0, 5)}...{trade.txHash.slice(-6)}</Typography>
                                                                <LinkIcon sx={{ color: trade.type === "BUY" ? "#10B981" : "#EF4444", fontSize: 14 }} />
                                                            </Link>
                                                        </Box>
                                                    </TradeBox>
                                                </Fragment>
                                            ))
                                        }
                                    </Box>
                                    <Pagination
                                        style={{ margin: 'auto', width: 'fit-content' }}
                                        variant="text"
                                        shape="circular"
                                        count={pagesOfTrades}
                                        page={pageOfTrades}  // current page
                                        onChange={(e, page) => setPageOfTrades(page)}  // handle page change
                                        renderItem={(data) => (
                                            <PaginationItem
                                                slots={{ previous: ArrowBackIcon, next: ArrowForwardIcon }}
                                                {...data}
                                            />
                                        )}
                                    />
                                </Box>
                            )}
                            {mode === "chat" && (
                                <ChatContainer>
                                    <ChatMessages ref={chatMessagesRef}>
                                        {chatLoading ? (
                                            <Box display="flex" justifyContent="center" py={4}>
                                                <CircularProgress size={24} sx={{ color: '#D3FF24' }} />
                                            </Box>
                                        ) : threadedChats.length === 0 ? (
                                            <Box display="flex" flexDirection="column" alignItems="center" py={4} gap={1}>
                                                <Typography color="#64748B" fontSize={14}>No messages yet</Typography>
                                                <Typography color="#475569" fontSize={12}>Be the first to comment</Typography>
                                            </Box>
                                        ) : (
                                            threadedChats.map((chat: any) => (
                                                <ChatBubble key={chat.id} depth={chat.depth}>
                                                    <UserAvatar address={chat.replyAddress} size={28} mr="0" />
                                                    <Box flex={1} minWidth={0}>
                                                        <Box display="flex" alignItems="center" gap="6px" mb="4px">
                                                            <Typography fontSize={12} fontWeight={600} color="white" noWrap>
                                                                {chat.replyAddress?.slice(0, 6)}...{chat.replyAddress?.slice(-4)}
                                                            </Typography>
                                                            <Typography fontSize={11} color="#64748B">
                                                                {Date.now() - new Date(chat.date || chat.createdAt).getTime() < 3600000
                                                                    ? <TimeDiff time={new Date(chat.date || chat.createdAt)} postfix="ago" />
                                                                    : new Date(chat.date || chat.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                                                                }
                                                            </Typography>
                                                        </Box>
                                                        <Typography fontSize={13} color="#E2E8F0" sx={{ wordBreak: 'break-word', lineHeight: 1.5 }}>
                                                            {chat.comment}
                                                        </Typography>
                                                        <Box
                                                            display="flex"
                                                            alignItems="center"
                                                            gap="4px"
                                                            mt="6px"
                                                            sx={{ cursor: 'pointer', opacity: 0.5, '&:hover': { opacity: 1 }, transition: 'opacity 0.2s' }}
                                                            onClick={() => setChatReplyTo(chat)}
                                                        >
                                                            <ReplyIcon sx={{ fontSize: 14, color: '#94A3B8' }} />
                                                            <Typography fontSize={11} color="#94A3B8">Reply</Typography>
                                                        </Box>
                                                    </Box>
                                                </ChatBubble>
                                            ))
                                        )}
                                    </ChatMessages>
                                    {chatReplyTo && (
                                        <ReplyBadge>
                                            <ReplyIcon sx={{ fontSize: 14 }} />
                                            <Typography fontSize={12} noWrap flex={1}>
                                                Replying to {chatReplyTo.replyAddress?.slice(0, 6)}...{chatReplyTo.replyAddress?.slice(-4)}
                                            </Typography>
                                            <IconButton size="small" onClick={() => setChatReplyTo(null)} sx={{ padding: '2px' }}>
                                                <CloseIcon sx={{ fontSize: 14, color: '#D3FF24' }} />
                                            </IconButton>
                                        </ReplyBadge>
                                    )}
                                    <ChatInputBox>
                                        <textarea
                                            value={chatComment}
                                            onChange={(e) => setChatComment(e.target.value)}
                                            placeholder={address ? "Write a message..." : "Connect wallet to chat"}
                                            disabled={!address || chatSending}
                                            rows={1}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault()
                                                    sendChat()
                                                }
                                            }}
                                        />
                                        <ChatSendButton
                                            onClick={sendChat}
                                            disabled={!address || !chatComment.trim() || chatSending}
                                        >
                                            {chatSending ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 18 }} />}
                                        </ChatSendButton>
                                    </ChatInputBox>
                                </ChatContainer>
                            )}
                            {
                                mode === "info" &&
                                <Box bgcolor="rgba(13, 13, 20, 0.6)" border="1px solid rgba(255, 255, 255, 0.05)" borderRadius="16px" display="flex" gap="16px" padding="24px" my="1.5em">
                                    <TokenLogo logo={detailData?.tokenImage} size="120px" />
                                    <Box>
                                        <Box display="flex" gap="0.2rem">
                                            <Typography fontSize={24} color="white">{detailData?.tokenName}</Typography>
                                        </Box>
                                        <Box display="flex" gap="0.2rem" alignItems="center">
                                            <Typography color="#D9D9D9" fontSize={14}>{detailData?.tokenDescription}</Typography>
                                        </Box>
                                        <Box display="flex" gap="0.2rem" mt={1}>
                                            <Creator token={detailData} />
                                            <Typography color="#9E9E9E" fontSize={14}>—</Typography>
                                            <Typography color="#9E9E9E" fontSize={14}>creator</Typography>
                                        </Box>
                                        {/* <Box display="flex" gap="0.2rem">
                            <Avatar sx={{ width: 24, height: 24, mr: '0.5rem' }} src={repliesIcon} />
                            <Typography color="#D9D9D9" fontSize={14}>{detailData?.replies}</Typography>
                            <Typography color="#9E9E9E" fontSize={14}>replies</Typography>
                        </Box> */}
                                        <Box display="flex" gap="0.2rem" mt={1}>
                                            <Avatar sx={{ width: 24, height: 24, mr: '0.5rem' }} src="/images/marketcap.png" />
                                            <Typography color="#D9D9D9" fontSize={14}>${priceFormatter(marketCap, 2)}</Typography>
                                            <Typography color="#9E9E9E" fontSize={14}>—</Typography>
                                            <Typography color="#9E9E9E" fontSize={14}>Market cap</Typography>
                                        </Box>
                                    </Box>
                                </Box>
                            }
                            {
                                mode === "analytics" &&
                                <Box my="1.5em">
                                    <TokenAnalyticsPanel network={network ?? undefined} address={id ?? undefined} />
                                </Box>
                            }
                            {
                                mode === "live" &&
                                <StreamPanel tokenAddress={id ?? undefined} creatorAddress={detailData?.creatorAddress} />
                            }
                            {
                                mode === "holders" &&
                                <HolderBox as="ol" mb="1.5em">
                                    <Box component="h3">Top Holders</Box>
                                    {topHolderPercent > 50 && (
                                        <Box sx={{
                                            display: 'flex',
                                            gap: 1,
                                            alignItems: 'center',
                                            background: 'rgba(239,68,68,0.08)',
                                            border: '1px solid rgba(239,68,68,0.15)',
                                            borderRadius: '8px',
                                            p: '8px 12px',
                                            mb: 1,
                                        }}>
                                            <Typography fontSize={12} color="#EF4444" fontWeight={500}>
                                                {'\u26A0\uFE0F'} Top holder owns {topHolderPercent.toFixed(1)}% of supply
                                            </Typography>
                                        </Box>
                                    )}
                                    <Box component="li">
                                        <div>1.</div>
                                        <Box display="flex" alignItems="center" flexGrow={1} minWidth={0}>
                                            <Avatar src="/images/logo.png" alt="Bonding Curve" sx={{ width: 18, height: 18, mr: '0.5rem' }} />
                                            <UserName
                                                address={tokenChain?.contractAddress}
                                                color="#9E9E9E"
                                                user={{
                                                    username: "Bonding Curve",
                                                    avatar: "bondingCurv"
                                                }}
                                            />
                                            <Link href={`${tokenChain?.explorerUrl}/address/${tokenChain?.contractAddress}`} target="_blank" style={{ textDecoration: 'none', height: 16 }}>
                                                <LinkIcon sx={{ color: "white", height: 16 }} />
                                            </Link>
                                        </Box>
                                        <Typography noWrap>{tokenChain?.totalSupply ? priceFormatter(Number(ethers.formatEther(lpBalance ?? 0n)) / tokenChain.totalSupply * 100, 2) : 0} %</Typography>
                                    </Box>
                                    {
                                        holders?.length > 0 && holders.sort((a: any, b: any) => b.tokenAmount - a.tokenAmount).map((item: any, index: number) => (
                                            <Box component="li" key={index}>
                                                <div>{index + 2}.</div>
                                                <Box display="flex" alignItems="center">
                                                    <UserName user={item.user} address={item.holderAddress} postfix={item.holderAddress === item.creatorAddress ? " (Creator) " : ""} color="#9E9E9E" />
                                                    <Link href={`${tokenChain?.explorerUrl}/address/${item.holderAddress}`} target="_blank" style={{ textDecoration: 'none', height: 16 }}>
                                                        <LinkIcon sx={{ color: "white", height: 16 }} />
                                                    </Link>
                                                </Box>
                                                <Typography>{tokenChain?.totalSupply ? priceFormatter(item.tokenAmount / tokenChain.totalSupply * 100, 2) : 0} %</Typography>
                                            </Box>
                                        ))}
                                </HolderBox>
                            }
                        </Box>
                    </Box>

                    {
                        !isMobile &&
                        <Box width="370px">
                            <SwapBox className={isLoading ? "disabled" : ""}>
                                    {!isSolanaToken && launched && (
                                        <Box display="flex" flexDirection="column" alignItems="center" gap={0.5} mb={1.5} pb={1.5} borderBottom="1px solid rgba(255,255,255,0.06)">
                                            <Typography fontSize={14} fontWeight={700} color="#10B981" fontFamily="'Space Grotesk', sans-serif">
                                                🎓 Trading via Uniswap V2
                                            </Typography>
                                            {detailData?.pairAddress && (
                                                <Link href={`${tokenChain?.explorerUrl}/address/${detailData.pairAddress}`} target="_blank" style={{ textDecoration: 'none' }}>
                                                    <Typography fontSize={11} color="#64748B" sx={{ '&:hover': { color: '#10B981' } }}>
                                                        View LP Pair <LinkIcon sx={{ fontSize: 11, verticalAlign: 'middle' }} />
                                                    </Typography>
                                                </Link>
                                            )}
                                        </Box>
                                    )}
                                    <Toggle style={{ width: "inherit" }}>
                                        <div className={tradeType === "buy" ? "active" : ""} data-tradetype="buy" onClick={() => setTradeType("buy")}>Buy</div>
                                        <div className={tradeType === "sell" ? "active" : ""} data-tradetype="sell" onClick={() => setTradeType("sell")}>Sell</div>
                                    </Toggle>
                                    <SwapContent
                                        amountIn={amountIn}
                                        approveHandler={approveHandler}
                                        detailData={detailData}
                                        error={error}
                                        estimateAmount={estimateAmount}
                                        ethBalance={ethBalance}
                                        exactInput={exactInput}
                                        isLoading={isLoading}
                                        swapHandler={swapHandler}
                                        tokenAllowance={tokenAllowance}
                                        tokenBalance={tokenBalance}
                                        tradeType={tradeType}
                                        setAmountIn={setAmountIn}
                                        setExactInput={setExactInput}
                                        setShowSlipaggeDialog={setShowSlipaggeDialog}
                                    />
                                </SwapBox>
                            <HolderBox as="ol" mb="1.5em">
                                <Box component="h3">Top Holders</Box>
                                {topHolderPercent > 50 && (
                                    <Box sx={{
                                        display: 'flex',
                                        gap: 1,
                                        alignItems: 'center',
                                        background: 'rgba(239,68,68,0.08)',
                                        border: '1px solid rgba(239,68,68,0.15)',
                                        borderRadius: '8px',
                                        p: '8px 12px',
                                        mb: 1,
                                    }}>
                                        <Typography fontSize={12} color="#EF4444" fontWeight={500}>
                                            {'\u26A0\uFE0F'} Top holder owns {topHolderPercent.toFixed(1)}% of supply
                                        </Typography>
                                    </Box>
                                )}
                                <Box component="li">
                                    <div>1.</div>
                                    <Box display="flex" alignItems="center" flexGrow={1} minWidth={0}>
                                        <User
                                            address={tokenChain?.contractAddress}
                                            color="#9E9E9E"
                                            user={{
                                                username: "Bonding Curve",
                                                avatar: "bondingCurv"
                                            }}
                                        />
                                        <Link href={`${tokenChain?.explorerUrl}/address/${tokenChain?.contractAddress}`} target="_blank" style={{ textDecoration: 'none', height: 16 }}>
                                            <LinkIcon sx={{ color: "white", height: 16 }} />
                                        </Link>
                                    </Box>
                                    <Typography noWrap>{tokenChain?.totalSupply ? priceFormatter(Number(ethers.formatEther(lpBalance ?? 0n)) / tokenChain.totalSupply * 100, 2) : 0} %</Typography>
                                </Box>
                                {
                                    holders?.length > 0 && holders.sort((a: any, b: any) => b.tokenAmount - a.tokenAmount).map((item: any, index: number) => (
                                        <Box component="li" key={index}>
                                            <div>{index + 2}.</div>
                                            <Box display="flex" alignItems="center">
                                                <UserName user={item.user} address={item.holderAddress} postfix={item.holderAddress === item.creatorAddress ? " (Creator) " : ""} color="#9E9E9E" />
                                                <Link href={`${tokenChain?.explorerUrl}/address/${item.holderAddress}`} target="_blank" style={{ textDecoration: 'none', height: 16 }}>
                                                    <LinkIcon sx={{ color: "white", height: 16 }} />
                                                </Link>
                                            </Box>
                                            <Typography>{tokenChain?.totalSupply ? priceFormatter(item.tokenAmount / tokenChain.totalSupply * 100, 2) : 0} %</Typography>
                                        </Box>
                                    ))}
                            </HolderBox>
                        </Box>
                    }
                </Box>
            </div>
            {
                isMobile ? (
                    <TradeMenu>
                        <button onClick={() => {
                            setTradeType("buy")
                            showModal('trade')
                        }}>Buy</button>
                        <button onClick={() => {
                            setTradeType("sell")
                            showModal('trade')
                        }}>Sell</button>
                    </TradeMenu>
                ) : null
            }

            <Dialog open={modal === "trade"} fullWidth keepMounted onClose={isLoading ? undefined : () => showModal(undefined)}>
                <DialogTitle textTransform="uppercase">
                    {tradeType}
                </DialogTitle>
                <DialogContent>
                    <SwapContent
                        amountIn={amountIn}
                        approveHandler={approveHandler}
                        detailData={detailData}
                        error={error}
                        estimateAmount={estimateAmount}
                        ethBalance={ethBalance}
                        exactInput={exactInput}
                        isLoading={isLoading}
                        swapHandler={swapHandler}
                        tokenAllowance={tokenAllowance}
                        tokenBalance={tokenBalance}
                        tradeType={tradeType}
                        setAmountIn={setAmountIn}
                        setExactInput={setExactInput}
                        setShowSlipaggeDialog={setShowSlipaggeDialog}
                    />
                </DialogContent>
            </Dialog>
            <Dialog
                open={showSlipaggeDialog}
                // TransitionComponent={Transition}
                keepMounted
                onClose={() => setShowSlipaggeDialog(false)}
            >
                <DialogTitle>
                    <Box display="flex" justifyContent="center" alignItems="center" width="100%">
                        <Typography color="#FFFFFF" fontSize="24px">
                            Slippage
                        </Typography>
                        <IconButton onClick={() => setShowSlipaggeDialog(false)} sx={{ position: 'absolute', right: 8 }}>
                            <CloseIcon sx={{ color: "#9E9E9E" }} />
                        </IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent>
                    <Box display="flex" flexDirection="row" alignContent="center" alignItems="center" justifyContent="center" gap={2}>
                        <Button
                            variant="contained"
                            onClick={() => {
                                setSlippage(0.1);
                                localStorage.setItem('slippage', '0.1');
                            }}
                            sx={{ borderColor: slippage === 0.1 ? 'white' : 'transparent', borderWidth: 2, borderStyle: 'solid' }}
                        >
                            0.1%
                        </Button>
                        <Button
                            variant="contained"
                            onClick={() => {
                                setSlippage(0.5)
                                localStorage.setItem('slippage', '0.5');
                            }}
                            sx={{ borderColor: slippage === 0.5 ? 'white' : 'transparent', borderWidth: 2, borderStyle: 'solid' }}
                        >
                            0.5%
                        </Button>
                        <Button
                            variant="contained"
                            onClick={() => {
                                setSlippage(1)
                                localStorage.setItem('slippage', '1');
                            }}
                            sx={{ borderColor: slippage === 1 ? 'white' : 'transparent', borderWidth: 2, borderStyle: 'solid' }}
                        >
                            1%
                        </Button>
                        <SlippageInput
                            slippage={slippage}
                            value={slippage}
                            onInput={(e: any) => {
                                const value = parseFloat(e.target.value);
                                if (value < 0.1 || value > 99) {
                                    e.preventDefault();
                                    e.target.value = value < 0.1 ? 0.1 : 99;
                                    return;
                                }
                                setSlippage(value);
                                localStorage.setItem('slippage', value.toString());
                            }}
                        />
                    </Box>
                </DialogContent>
            </Dialog>
        </PageBox>
    );
};