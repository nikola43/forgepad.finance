'use client'

import React, { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTheme, useMediaQuery, styled } from '@mui/material';
import { Alert, Avatar, Box, Button, Dialog, DialogContent, DialogTitle, FormControl, IconButton, Pagination, PaginationItem, Typography } from "@mui/material";
import CircularProgress from '@mui/material/CircularProgress';
import LinkIcon from '@mui/icons-material/OpenInNewOutlined';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CopyIcon from '@mui/icons-material/ContentCopy';
import copy from 'copy-to-clipboard';
import { ethers, MaxUint256 } from 'ethers';
import { NumericFormat } from "react-number-format";
import PageBox from "@/components/layout/pageBox";
import TokenLogo from "@/components/tokenLogo";
import { priceFormatter } from "@/utils/price";
import Toggle from "@/components/toggle";
import { Creator, User, UserName } from "@/components/cards/user";

// import imgUniswap from '@/assets/images/uniswap.png';
// import marketcapIcon from '@/assets/images/marketcap.png';
import TelegramIcon from '@/assets/images/telegram.svg';
import TwitterIcon from '@/assets/images/x.svg';
import WebsiteIcon from '@/assets/images/website.svg';
// import ethIcon from '@/assets/images/coin/eth-1.png';

import { TVChartContainer as TVChartContainerAdvanced } from '@/components/tvchart';
import { TimeDiff } from "@/components/time";
// import { useContractInfo } from "@/hooks/contract";
import { useHandlers, useTokenInfo } from "@/hooks/token";
import toast from "react-hot-toast";
import { useAppKit, useAppKitAccount, useAppKitNetwork } from "@reown/appkit/react";
import { useMainContext } from "@/context";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
// import { useUserInfo } from "@/hooks/user";
// import { useChainInfo, useContractInfo, useSwitchChain } from "@/hooks/config";
import { AssetUtil, ChainController } from "@reown/appkit-controllers"
import { AppKitNetwork } from "@reown/appkit/networks";
import { useUserInfo } from "@/hooks/user";

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
    border-bottom: 1px solid #27272A;
`

const Progress = styled('div') <{ value: number }>`
    max-width: 400px;
    width: 100%;
    height: 10px;
    background: black;
    position: relative;
    transform: skewX(-33deg);
    &::after {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: ${({ value }) => value}%;
        background: white;
    }
    @media(max-width: 800px) {
        min-width: 200px;
    }
`

const SmallButton = styled(Button)`
    &.MuiButton-root {
        background: #121212;
        border-radius: 4px;
        color: #C1C1C1;
        font-size: 12px;
        padding: 2px 8px;
        &:hover {
            background: #121212;
            color: #C1C1C1;
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
    padding: 8px;
    background: #121212;
    & > button {
        flex: 1;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.1);
        border: none;
        outline: none;
        border-radius: 8px;
        color: white;
        font-size: 16px;
        cursor: pointer;
    }
`

const StatsBox = styled('div')`
    margin-top: 4px;
    display: flex;
    background: #212121;
    border-radius: 4px;
    padding: 4px 8px;
    gap: 4px;
`

const CurrencyInput = styled(Box)`
  display: flex;
  flex-direction: column;
  background: #121212;
  border-radius: 4px;
  padding: 10px 20px;
  gap: 8px;
  & span.balance {
    align-self: flex-end;
    color: #FFF8;
    font-size: small;
  }
  & input {
    font-size: 20px;
    background: transparent;
    color: white;
    border: none;
    outline: none;
    width: 100%;
    text-align: right;
  }
  ${({ theme }) => theme.breakpoints.down("sm")} {
    padding: 8px 16px;
  }
  & span.balance {
    ${({ theme }) => theme.breakpoints.down("sm")} {
      font-size: x-small;
    }
  }
  & input {
    ${({ theme }) => theme.breakpoints.down("sm")} {
      font-size: 16px;
    }
  }
`;

const SocialLink = styled(Link)`
  background: #27272A;
  border-radius: 4px;
  font-size: 12px;
  color: white;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  ${({ theme }) => theme.breakpoints.down("sm")} {
    background: transparent;
    padding: 0;
    opacity: 0.6;
    &:hover {
      opacity: 1;
    }
  }
`;

const TradeBox = styled(Box)`
  display: grid;
  grid-template-columns: 1fr 0.5fr 0.5fr 0.5fr 1fr 1fr;
  align-items: center;
  padding: 0.3em 1em;

  ${({ theme }) => theme.breakpoints.down("sm")} {
    grid-template-columns: 0.5fr 0.5fr 0.5fr;
    font-size: 12px;
    padding: 0.3em 0.5em;
  }
`;

const HolderBox = styled(Box)`
  background: #212121;
  border-radius: 8px;
  list-style-position: inside;
  padding: 24px;
  color: white;
  h3 {
    font-size: 18px;
    line-height: 18px;
    margin: 0;
    margin-bottom: 16px;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px dotted #ddd6;
    padding: 8px 0;
    gap: 8px;
    & > :first-of-type {
      flex: 0 0 1.5em;
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
      font-size: 16px;
    }
    li {
      padding: 6px 0;
    }
  }
`;

const SwapBox = styled(Box)`
  background: #212121;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;  /* Center items horizontally */
  justify-content: center;  /* Center items vertically */
  gap: 15px;
  padding: 24px;
  width: 100%;
  max-width: 385px;  /* Ensure a maximum width to prevent overflow */
  margin: 0 auto;  /* Center the SwapBox */
  box-sizing: border-box;

  & button.medium, & button.small {
    background: #FFFFFF0F;
    color: #E7E3D8;
    border-radius: 24px;
    font-family: Inter;
    font-size: 12px;
    font-weight: 500;
    padding: 8px 16px;
    display: flex;
    gap: 8px;
    text-transform: none;
    align-items: center;
    min-width: unset;
    &.medium:hover {
      background: #FFFFFF2F;
      color: white;
    }
  }

  & button.small {
    padding: 4px 8px;
  }

  &.disabled {
    display: flex;  /* Ensure flex display for centering */
    flex-direction: column;
    align-items: center;  /* Center items horizontally */
    justify-content: center;  /* Center items vertically */
    position: relative;
    overflow: hidden;
    filter: grayscale(0.8);
    opacity: 0.5;
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
    border-radius: 24px;
  }

  & button.medium, & button.small {
    ${({ theme }) => theme.breakpoints.down("sm")} {
      font-size: 10px;
      padding: 6px 12px;
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
                        <SmallButton onClick={() => setAmountIn(tokenBalance ? ethers.formatEther(tokenBalance * 25n / 100n) : undefined)}>25%</SmallButton>
                        <SmallButton onClick={() => setAmountIn(tokenBalance ? ethers.formatEther(tokenBalance * 50n / 100n) : undefined)}>50%</SmallButton>
                        <SmallButton onClick={() => setAmountIn(tokenBalance ? ethers.formatEther(tokenBalance * 75n / 100n) : undefined)}>75%</SmallButton>
                        <SmallButton onClick={() => setAmountIn(ethers.formatEther(tokenBalance))}>100%</SmallButton>
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
                        ? <Button fullWidth sx={{ borderRadius: '16px', fontSize: '20px', py: '12px', textTransform: 'none' }} disabled={isLoading || !!error || !amountIn} onClick={approveHandler}>
                            Approve {isLoading && <CircularProgress size={18} style={{ color: "black", marginLeft: "1em" }} />}
                        </Button>
                        : <Button fullWidth sx={{ borderRadius: '16px', fontSize: '20px', py: '12px', textTransform: 'none' }} disabled={isLoading || !!error || !amountIn} onClick={swapHandler}>
                            {tradeType === "buy" ? "Buy" : "Sell"} {isLoading && <CircularProgress size={18} style={{ color: "black", marginLeft: "1em" }} />}
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
    </>
}

export default function Token() {
    const { address } = useAppKitAccount()
    const searchParams = useSearchParams()
    const network = searchParams.get('network')
    const id = searchParams.get('address')
    // const [detailData, setDetailData] = React.useState<any>(null);
    // const [chatList, setChatList] = React.useState<any[]>([]);
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
    const { tokenInfo, reload: reloadTokenInfo } = useTokenInfo(id as string, network as string, pageOfTrades, pageSize)
    const ethBalance = useMemo(() => userInfo?.balance ?? 0, [userInfo])
    const { balance: tokenBalance, allowance: tokenAllowance, curveBalance: lpBalance } = useMemo(() => tokenInfo ?? { balance: 0n, allowance: 0n, curveBalance: 0n }, [tokenInfo])
    const poolInfo = useMemo(() => tokenInfo?.poolInfo, [tokenInfo])
    const {
        tokenContract,
        tokenDetils: detailData,
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



    const marketCap = useMemo(() => Number(detailData?.marketcap ?? 0), [detailData])

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
            await tx.wait()
            toast.success("Successfully approved!");
            setIsLoading(false);
        } catch (error: any) {
            setIsLoading(false);
            const messageError = error?.shortMessage || error?.data?.message;
            toast.error(messageError);
        }
    }, [detailData, tradeType, amountIn, address, tokenContract])

    const showSuccessToast = useCallback((message: string) => {
        const link = `${tokenChain?.explorerUrl}/tx/${message}`
        toast.success(
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span>Transaction success!</span>
                <a style={{ textDecoration: 'none', color: 'white' }} target="_blank" rel="noreferrer" href={link}>See tx in explorer <LinkIcon sx={{ fontSize: 14 }} /></a>
            </div>
        );
    }, [tokenChain])

    const swapHandler = useCallback(async () => {
        setIsLoading(true);
        try {
            if (!address || !handlers)
                throw Error("Connect wallet");
            const _slippage = BigInt(Math.floor(slippage * 100));
            if (tradeType === "buy") {
                const tx = await handlers.buyToken(detailData.tokenAddress, amountIn ?? '0', _slippage, exactInput)
                showSuccessToast(tx.hash)
            } else {
                const tx = await handlers.sellToken(detailData.tokenAddress, amountIn ?? '0', _slippage)
                showSuccessToast(tx.hash)
            }
            setAmountIn(undefined)
            setIsLoading(false);
            reloadTokenInfo()
        } catch (error: any) {
            setIsLoading(false);
            console.log({
                error
            });
            const messageError = error?.shortMessage || error?.data?.message;
            toast.error(messageError);
        }
    }, [detailData, tokenContract, amountIn, address, slippage, launched, showSuccessToast, reloadTokenInfo, tradeType, exactInput, estimateAmount])

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

    return (
        <PageBox display="flex" flexDirection="column" justifyContent="space-between" gap="1.5em" maxWidth="100%" overflow="hidden" pt={6} bgcolor="#101012">
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
                        <IconButton sx={{ width: 'fit-content' }} onClick={() => copy(detailData?.tokenAddress)}>
                            <CopyIcon sx={{ color: "#9E9E9E", width: 14, height: 14 }} />
                        </IconButton>
                    </Box>
                    <Box display="flex" gap="8px" alignItems="center" width="100%">
                        <TokenLogo logo={detailData?.tokenImage} size={isMobile ? "75px" : "120px"} />
                        {
                            !isMobile &&
                            <Box>
                                <Box display="flex" gap="8px" alignItems="baseline" position="relative" width="fit-content">
                                    <Typography fontSize={48} fontFamily="Arial" fontWeight="bold" color="white">${priceFormatter(marketCap, 2)}</Typography>
                                    <Typography fontSize={12} color="white">Market cap</Typography>
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
                                    <Typography fontSize={14} color={Number(detailData?.price15m ?? 0) >= 0 ? "lightgreen" : "darkorange"}>
                                        {Number(detailData?.price15m ?? 0) >= 0 ? '+' : '-'}${priceFormatter(Math.abs(Number(detailData?.price15m ?? 0)))} ({Number(detailData?.priceChange15m).toFixed(2)}%)
                                    </Typography>
                                    <Typography fontSize={12} color="white">Past 15m</Typography>
                                </Box>
                                <Box display="flex" gap="8px">
                                    <StatsBox>
                                        <Typography fontSize={12} color="#9E9E9E">Virtual Liquidity:</Typography>
                                        <Typography fontSize={12} color="white">${priceFormatter(detailData?.liquidity ?? 0, 2, true, true)}</Typography>
                                    </StatsBox>
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
                                !launched &&
                                <>
                                    <Typography fontSize={{ xs: 10, sm: 10, md: 14 }} color="#DDD">Progress ({Math.min(99.99, Number(detailData?.progress ?? 0)).toFixed(2)}%)</Typography>
                                    <Progress value={Math.min(100, Number(detailData?.progress ?? 0))} />
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
                            <Typography fontSize={32} fontFamily="Arial" fontWeight="bold" color="white">${priceFormatter(marketCap, 2)}</Typography>
                            <Typography fontSize={12} color="white">Market cap</Typography>
                        </Box>
                        <Box display="flex" gap="8px" alignItems="baseline">
                            <Typography fontSize={14} color="lightgreen">
                                {Number(detailData?.price ?? 0) >= Number(detailData?.price15m ?? 0) ? '+' : '-'}${priceFormatter(Number(detailData?.price15m ?? 0) - Number(detailData?.price15MinAgo ?? 0))} ({Number(detailData?.priceChange15m).toFixed(2)}%)
                            </Typography>
                            <Typography fontSize={12} color="white">Past 15m</Typography>
                        </Box>
                        <Box display="flex" flexDirection="column" alignItems="stretch" gap="1px">
                            <StatsBox>
                                <Typography fontSize={12} color="#9E9E9E">Virtual Liquidity:</Typography>
                                <Typography fontSize={12} color="white">${priceFormatter(detailData?.liquidity ?? 0, 2, true, true)}</Typography>
                            </StatsBox>
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
                                <Typography fontSize={12} color="#9E9E9E">Will be deposited to:</Typography>
                                <Typography fontSize={12} color="white" textTransform="capitalize">{pool?.name} {pool?.version} pool</Typography>
                            </StatsBox>
                        </Box>
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
                                            <LinkIcon sx={{ color: "#e19428", height: 16 }} />
                                        </Button>
                                    </Link>
                                }
                            </Box>
                        } */}
                        <TVChartContainerAdvanced token={id} network={network} dex={selectedDex} />
                        <Box mt="2em">
                            <Box display="flex" justifyContent="space-between" flexDirection={{ xs: 'column', sm: 'row' }}>
                                <Toggle inner="true">
                                    <div className={mode === "trades" ? "active" : ""} onClick={() => setMode("trades")}>Trades</div>
                                    <div className={mode === "info" ? "active" : ""} onClick={() => setMode("info")}>Info</div>
                                    {
                                        isMobile &&
                                        <div className={mode === "holders" ? "active" : ""} onClick={() => setMode("holders")}>Holders</div>
                                    }
                                </Toggle>
                            </Box>
                            {mode === "trades" && (
                                <Box mb="1.5em">
                                    <Box display="flex" flexDirection="column" my="1.5em" borderRadius="12px" overflow="hidden" bgcolor="#191919" border="1px solid #27272A">
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
                                                    <TradeBox sx={{ py: 2, color: trade.type === "BUY" ? "lightgreen" : "#ef5350" }}>
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
                                                        <Box display={{ sm: 'flex', xs: 'none' }} alignItems="center">
                                                            <UserName user={trade.user} address={trade.swapperAddress} color={trade.type === "BUY" ? "lightgreen" : "#ef5350"} size={18} />
                                                        </Box>
                                                        <Box display={{ sm: 'block', xs: 'none' }}>
                                                            <Link style={{ textDecoration: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} href={`${tokenChain?.explorerUrl}/tx/${trade.txHash}`} target="_blank">
                                                                <Typography color={trade.type === "BUY" ? "lightgreen" : "#ef5350"} fontSize="small">{trade.txHash.slice(0, 5)}...{trade.txHash.slice(-6)}</Typography>
                                                                <LinkIcon sx={{ color: trade.type === "BUY" ? "lightgreen" : "#ef5350", fontSize: 14 }} />
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
                            {
                                mode === "info" &&
                                <Box bgcolor="#212121" borderRadius="16px" display="flex" gap="16px" padding="24px" my="1.5em">
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
                                mode === "holders" &&
                                <HolderBox as="ol" mb="1.5em">
                                    <Box component="h3">Top Holders</Box>
                                    <Box component="li">
                                        <div>1.</div>
                                        <Box display="flex" alignItems="center" flexGrow={1} minWidth={0}>
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
                            <SwapBox className={isLoading || (!isSolanaToken && launched) ? "disabled" : ""}>
                                <Toggle style={{ width: "inherit" }}>
                                    <div className={tradeType === "buy" ? "active" : ""} onClick={() => setTradeType("buy")}>Buy</div>
                                    <div className={tradeType === "sell" ? "active" : ""} onClick={() => setTradeType("sell")}>Sell</div>
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
                isMobile &&
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