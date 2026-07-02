import { Avatar, Box, CircularProgress, Dialog, InputAdornment, InputBase, TextField, Typography, useMediaQuery } from "@mui/material"
import Image from "next/image"
import Link from "next/link"
import styled, { keyframes } from "styled-components"
// import imgLogo from '@/assets/images/logo.png';
// import imgForge0 from '@/assets/images/forge0.png';
// import imgForge1 from '@/assets/images/forge1.png';
// import imgForge2 from "@/assets/images/logo.png";
// import imgBanner from "@/assets/images/banner.png"
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CubeIcon, DialogHowItWorks, HomeIcon, TokenIcon, WalletIcon } from "./sidebar";
import { CaipNetwork, useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitState, useDisconnect, useWalletInfo } from "@reown/appkit/react";
import { AssetUtil, ChainController } from "@reown/appkit-controllers"
import LogoutIcon from '@mui/icons-material/Logout';
import { User, UserName } from "../cards/user";
import { useAccount } from "@/hooks/user";
import { useMainContext } from "@/context";
import { AppKitNetwork } from "@reown/appkit/networks";
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import TwitterIcon from '@/assets/images/x.svg';
import { FORGE_TWITTER_URL } from "@/config";
import TokenLogo from "../tokenLogo";
import { useNewTrades, useTokens } from "@/hooks/token";
import { priceFormatter } from "@/utils/price";

const beat = keyframes`
    from {
        transform: scale(1);
    }
    to {
        transform: scale(0.95);
    }
`

const HeaderBox = styled(Box)`
    position: fixed;
    top: 0;
    left: var(--sidebar-w, 0px);
    right: 0;
    transition: left 0.2s ease;
    max-height: 64px;
    z-index: 3;
    background: rgba(6, 6, 10, 0.8);
    backdrop-filter: blur(20px) saturate(180%);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    gap: 16px;
`

const ScrollBox = styled(Box)<{ count: number }>`
    flex: 1;
    position: relative;
    z-index: 1;
    & > div {
        // padding-right: 8px;
    }
    & > div:last-child {
        position: absolute;
        left: 100%;
        width: ${({count}) => `${100 / count}%`};
        opacity: 0;
    }
`

const TradesBox = styled(Box)`
    position: relative;
    overflow-x: hidden;
    justify-content: center;
    gap: 60px;
    box-sizing: border-box;
    align-items: center;
    &.gradient::after {
        content: "";
        background: linear-gradient(90deg, rgba(6,6,10,0.9), transparent 120px), linear-gradient(-90deg, rgba(6,6,10,0.9) 0%, transparent 120px);
        position: absolute;
        height: 63px;
        left: 0;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
    }
    &.gradient::before {
        content: "";
        background: radial-gradient(51.54% 206.16% at 50% 50%, rgba(6,6,10,0.95), transparent);
        width: 360px;
        height: 100px;
        overflow: hidden;
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
    }
    img.logo {
        position: relative;
        z-index: 2;
        transition: transform 0.3s ease;
        &:hover {
            transform: scale(1.05);
        }
    }
    &.move ${ScrollBox} > div {
        transition: transform 0.9s, opacity 0.5s;
        transform: translateX(-100%);
        &:first-child {
            opacity: 0;
        }
        &:last-child {
            opacity: 1;
        }
    }
`


const Flex = styled.div`
    display: flex;
    padding: 20px 16px;
    align-items: center;
    gap: 40px;
`

const LogoWrapper = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 42px;
`

const Banner = styled.div`
    overflow: hidden;
    background: black;
    border-radius: 16px;
    border: 1px solid #9998;
    width: 410px;
    flex: 0 0 411px;
    // position: fixed;
    top: 14px;
    z-index: 2;
    box-shadow: 0 0 10px #0008;
`

const StyledButton = styled.button`
    height: 40px;
    padding: 8px 16px;
    background: linear-gradient(135deg, #D3FF24 0%, #e4ff66 100%);
    border: none;
    border-radius: 10px;
    color: #0a0a0f;
    font-size: 14px;
    font-family: 'Space Grotesk', 'Inter', sans-serif;
    font-weight: 600;
    line-height: 20px;
    letter-spacing: -0.01em;
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: center;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    &:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(209, 255, 26, 0.3);
    }
    &:active {
        transform: translateY(0);
    }
    svg {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        fill: currentColor;
    }
`

const StyledDropdownButton = styled.div`
    position: relative;
    & > div {
        position: absolute;
        display: none;
        top: calc(100% + 6px);
        right: 0;
        &::before {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            content: "";
            background: rgba(13, 13, 20, 0.95);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        }
        &::after {
            content: "";
            position: absolute;
            top: -10px;
            left: 0;
            right: 0;
            height: 10px;
        }
        padding: 4px;
        min-width: 200px;
        z-index: 3;
        ${StyledButton} {
            font-family: 'Inter', sans-serif;
            font-size: 13px;
            font-weight: 500;
            background: none;
            border-radius: 8px;
            border: none;
            color: #94A3B8;
            width: 100%;
            justify-content: flex-start;
            height: 36px;
            position: relative;
            z-index: 1;
            &:hover {
                background: rgba(255, 255, 255, 0.06);
                color: white;
                box-shadow: none;
                transform: none;
            }
        }
    }
    &:not(.done):hover > div {
        display: flex;
        flex-direction: column;
    }
`

const Buttons = styled.div`
    display: flex;
    gap: 8px;
    white-space: nowrap;
    justify-content: flex-end;
`

const SearchToken = styled(TextField)`
    & .MuiOutlinedInput-root {
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 14px;
        transition: all 0.2s ease;

        input {
            padding: 8px 12px;
            font-family: 'Inter', sans-serif;
            font-size: 14px;
            color: white;
            &::placeholder {
                color: rgba(255, 255, 255, 0.3);
            }
        }

        &:hover, &.Mui-focused {
            border-color: rgba(209, 255, 26, 0.3);
            background: rgba(255, 255, 255, 0.06);
        }

        & fieldset {
            border-color: transparent !important;
        }
    }
`;

const AvatarWrapper = styled(Box)`
  position: relative;
  display: inline-block;
  & > label {
    position: absolute;
    right: 0;
    bottom: 0;
  }
`

const HiddenInput = styled("input")`
  clip: rect(0 0 0 0);
  clippath: inset(50%);
  height: 1;
  overflow: hidden;
  position: absolute;
  bottom: 0;
  left: 0;
  white-space: nowrap;
  width: 1;
`

const FitDialog = styled(Dialog)`
    & .MuiDialog-paper {
        width: fit-content;
    }
`

const SocialLinks = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    a {
        height: 35px;
        &:hover {
            opacity: 0.65;
        }
    }
`

const BootstrapInput = styled(InputBase)(({ theme }) => ({
    "label + &": {
        marginTop: '1rem',
    },
    "& .MuiInputBase-input": {
        borderRadius: "16px",
        position: "relative",
        backgroundColor: "#FFFFFF0F",
        border: "none",
        padding: "10px 20px",
    },
}))

const TradeBox = styled(Box)`
    @keyframes stretch {
        from { transform: translateX(100%) }
        to { transform: translateX(0) }
    }
    &.new {
        animation: stretch 0.8s;
    }
`

const badgePulse = keyframes`
    0% { transform: scale(0.5); opacity: 0; }
    50% { transform: scale(1.15); }
    100% { transform: scale(1); opacity: 1; }
`

const BadgePulse = styled(Box)`
    animation: ${badgePulse} 0.4s ease-out;
`

function NetworkLogo({ size = 24, network }: { size?: number, network?: CaipNetwork }) {
    const [logo, setLogo] = useState<string>()
    useEffect(() => {
        if (network?.assets)
            AssetUtil.fetchNetworkImage(network.assets?.imageId).then(v => setLogo(v))
    }, [network])
    return <Avatar sx={{ width: size, height: size }} src={logo} />
}

export default function Header() {
    const isMobile = useMediaQuery('(max-width: 800px)')
    const [scrollTop, setScrollTop] = useState(0)
    const pathname = usePathname()
    const router = useRouter()
    const [modal, setModal] = useState<string>()

    const { appKit } = useMainContext()
    // const { open, close } = useAppKit()
    const { isConnected, address, caipAddress } = useAppKitAccount()
    const { account } = useAccount()
    const { chainId, caipNetwork } = useAppKitNetwork()
    // const { disconnect } = useDisconnect()
    const { walletInfo } = useWalletInfo()
    // const state = useAppKitState()

    const isDashboard = useMemo(() => pathname === '/', [pathname])
    const networks = ChainController.getCaipNetworks()
    const dropdownRef = useRef<any>(undefined)
    const [isSwitching, setSwitching] = useState(true)
    const [searchWord, setSearchWord] = useState('');
    const [width, setWidth] = useState(0)
    const [trades, setTrades] = useState<any[]>([])
    const [newTradeCount, setNewTradeCount] = useState(0)
    const slider = useRef<HTMLElement>(null)
    const searchRef = useRef<HTMLDivElement>(null)

    const { trades: newTrades } = useNewTrades()

    const count = useMemo(() => {
        if (!width)
            return 1
        return Math.floor((width - 280 - 130) / 350)
    }, [width])

    useEffect(() => {
        const updateWidth = () => {
            if (slider.current) {
                setWidth(slider.current.offsetWidth);
            }
        };
        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => {
            window.removeEventListener('resize', updateWidth);
        };
    }, [])

    useEffect(() => {
        setTrades((trades) => newTrades?.length ? [...trades, ...newTrades] : trades)
        if (newTrades?.length) setNewTradeCount(c => c + newTrades.length)
    }, [newTrades])

    // Reset trade count on page navigation
    useEffect(() => {
        setNewTradeCount(0)
    }, [pathname])

    useEffect(() => {
        // console.log("network", chainId, caipNetwork)
        // close()
        setSwitching(false)
    }, [caipNetwork])

    useEffect(() => {
        if (window !== undefined) {
            setScrollTop(window.scrollY)
            window.addEventListener('scroll', function () {
                setScrollTop(window.scrollY)
            })
        }
        const timer = setInterval(() => {
            slider.current?.classList.add("move")
            setTimeout(() => {
                setTrades((trades) => trades.length > 8 ? trades.slice(1) : [...trades.slice(1), trades[0]])
                slider.current?.classList.remove("move")
            }, 1000)
        }, 2000)
        return () => {
            clearInterval(timer)
        }
    }, [])

    const { tokens: searchResults } = useTokens({
        searchWord: searchWord, pageNumber: 1, pageSize: 5
    })

    // Close search results on click outside
    useEffect(() => {
        const handleClickAway = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setSearchWord('')
            }
        }
        document.addEventListener('mousedown', handleClickAway)
        return () => document.removeEventListener('mousedown', handleClickAway)
    }, [])

    const handleSwitch = (network: any) => {
        setSwitching(true)
        appKit?.switchNetwork(network)
        // open({
        //     view: "Networks", namespace: network.chainNamespace, 
        // })
        dropdownRef.current.classList.add('done')
        setTimeout(() => dropdownRef.current?.classList?.remove('done'), 1000)
    }

    if (isMobile)
        return <>
            <HeaderBox p="6px 8px" style={{ border: 'none' }}>
                <Link href="/">
                    <img src="/images/logo.png" width={54} height={54} style={{ border: "1px solid #D3FF24", borderRadius: "4px" }} alt="" />
                </Link>
                <Link href="/forge" style={{ textDecoration: "none", marginLeft: "auto", marginRight: "60px" }}>
                    <StyledButton className="effect-button" onClick={() => setModal('how')} style={{ height: "40px" }}>
                        <TokenIcon />
                        Create Token
                    </StyledButton>
                </Link>
            </HeaderBox>
            {
                isDashboard &&
                <>
                    <TradesBox mt="20px" px="8px" ref={slider}>
                    {
                        trades?.length > 0 &&
                        <ScrollBox display="flex" count={2}>
                            {
                                new Array(3).fill(0).map((_, i) => 
                                    <Box key={`lasttrade-${i}`} flex={1} display="flex" gap="8px" alignItems="center">
                                        <TokenLogo logo={trades[i]?.tokenImage} size={48} />
                                        <Box>
                                            <Typography color="white" fontSize={14} fontWeight={700}>{trades[i]?.tokenSymbol}</Typography>
                                            <Typography color={trades[i]?.type === "SELL" ? "#EF4444" : "#10B981"} fontSize={10} fontWeight={600}>{trades[i]?.type}</Typography>
                                            <Typography color="#AAA" fontSize={10}>{trades[i]?.tokenAddress?.slice(0, 6)}...{trades[i]?.tokenAddress?.slice(-4)}</Typography>
                                        </Box>
                                    </Box>
                                )
                            }
                        </ScrollBox>
                    }
                    </TradesBox>
                    <Box px="8px" mt={2} sx={{ position: 'relative' }}>
                        <SearchToken
                            placeholder="Search token"
                            fullWidth
                            value={searchWord}
                            onChange={(e) => setSearchWord(e.target.value)}
                            slotProps={{
                                input: {
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <SearchIcon sx={{ width: 18, height: 18 }} />
                                        </InputAdornment>
                                    ),
                                    endAdornment: (
                                        <InputAdornment style={{ cursor: "pointer", visibility: searchWord.length > 0 ? 'visible' : 'hidden' }} position="end" onClick={() => {
                                            setSearchWord('')
                                        }}>
                                            <CloseIcon sx={{ height: 18 }} />
                                        </InputAdornment>
                                    )
                                }
                            }}
                        />
                        {searchWord.length > 1 && (
                            <Box sx={{
                                position: 'absolute',
                                top: '100%',
                                left: 8,
                                right: 8,
                                mt: 1,
                                background: 'rgba(13,13,20,0.98)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: '12px',
                                boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                                zIndex: 10,
                                maxHeight: '400px',
                                overflow: 'auto',
                                p: 1,
                            }}>
                                {searchResults?.length > 0 ? searchResults.map((token: any) => (
                                    <Box key={token.tokenAddress}
                                        onClick={() => { router.push(`/token?network=${token.network}&address=${token.tokenAddress}`); setSearchWord('') }}
                                        sx={{
                                            display: 'flex', gap: 1.5, alignItems: 'center', p: 1.5, borderRadius: '8px',
                                            cursor: 'pointer', transition: 'background 0.15s',
                                            '&:hover': { background: 'rgba(255,255,255,0.06)' }
                                        }}
                                    >
                                        <TokenLogo logo={token.tokenImage} size={36} style={{ borderRadius: '8px' }} />
                                        <Box flex={1} minWidth={0}>
                                            <Typography color="white" fontSize={13} fontWeight={600} noWrap>{token.tokenName}</Typography>
                                            <Typography color="#64748B" fontSize={11}>{token.tokenSymbol} · MC: ${priceFormatter(token.marketcap, 2)}</Typography>
                                        </Box>
                                        <img src={`/networks/${token.network}.svg`} width={16} height={16} alt="" />
                                    </Box>
                                )) : (
                                    <Typography color="#64748B" fontSize={13} p={2} textAlign="center">No results found</Typography>
                                )}
                            </Box>
                        )}
                    </Box>
                </>
            }
        </>
    return <>
        <HeaderBox p="6px 27px">
            <Box flex={1} display="flex" gap="36px" alignItems="center">
                <Link href="/">
                    <img src="/images/logo.png" width={64} height={64} alt="logo" />
                </Link>
                <Box sx={{ position: 'relative', flex: 1 }} ref={searchRef}>
                    <SearchToken
                        placeholder="Search token"
                        fullWidth
                        value={searchWord}
                        onChange={(e) => setSearchWord(e.target.value)}
                        slotProps={{
                            input: {
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon sx={{ width: 18, height: 18 }} />
                                    </InputAdornment>
                                ),
                                endAdornment: (
                                    <InputAdornment style={{ cursor: "pointer", visibility: searchWord.length > 0 ? 'visible' : 'hidden' }} position="end" onClick={() => {
                                        setSearchWord('')
                                    }}>
                                        <CloseIcon sx={{ height: 18 }} />
                                    </InputAdornment>
                                )
                            }
                        }}
                    />
                    {searchWord.length > 1 && (
                        <Box sx={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            mt: 1,
                            background: 'rgba(13,13,20,0.98)',
                            backdropFilter: 'blur(20px)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '12px',
                            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                            zIndex: 10,
                            maxHeight: '400px',
                            overflow: 'auto',
                            p: 1,
                        }}>
                            {searchResults?.length > 0 ? searchResults.map((token: any) => (
                                <Box key={token.tokenAddress}
                                    onClick={() => { router.push(`/token?network=${token.network}&address=${token.tokenAddress}`); setSearchWord('') }}
                                    sx={{
                                        display: 'flex', gap: 1.5, alignItems: 'center', p: 1.5, borderRadius: '8px',
                                        cursor: 'pointer', transition: 'background 0.15s',
                                        '&:hover': { background: 'rgba(255,255,255,0.06)' }
                                    }}
                                >
                                    <TokenLogo logo={token.tokenImage} size={36} style={{ borderRadius: '8px' }} />
                                    <Box flex={1} minWidth={0}>
                                        <Typography color="white" fontSize={13} fontWeight={600} noWrap>{token.tokenName}</Typography>
                                        <Typography color="#64748B" fontSize={11}>{token.tokenSymbol} · MC: ${priceFormatter(token.marketcap, 2)}</Typography>
                                    </Box>
                                    <img src={`/networks/${token.network}.svg`} width={16} height={16} alt="" />
                                </Box>
                            )) : (
                                <Typography color="#64748B" fontSize={13} p={2} textAlign="center">No results found</Typography>
                            )}
                        </Box>
                    )}
                </Box>
            </Box>
            <Box flex={1} display="flex" gap="18px" alignItems="center" justifyContent="flex-end">
                <SocialLinks>
                    <Link href={FORGE_TWITTER_URL} target="_blank"><Image src={TwitterIcon} width={50} height={35} alt="twitter" /></Link>
                </SocialLinks>
                <Link href="/forge" style={{ textDecoration: "none" }}>
                    <StyledButton className="effect-button">
                        <TokenIcon />
                        Create Token
                    </StyledButton>
                </Link>
                {
                    isConnected
                    ? <StyledDropdownButton ref={dropdownRef}>
                        <StyledButton className="effect-button" onClick={() => appKit?.open({ view: 'Networks' })}>
                            {
                                walletInfo
                                ? <Avatar src={walletInfo.icon} sx={{ width: 24, height: 24 }} />
                                : <WalletIcon />
                            }
                            <UserName
                                user={account}
                                address={address}
                                me
                                mr={0}
                                fontSize="12px"
                                color="#0a0a0f"
                            />
                            {
                                isSwitching
                                ? <CircularProgress size={20} />
                                : <NetworkLogo network={caipNetwork} />
                            }
                        </StyledButton>
                        <div>
                            {
                                networks?.filter(c => chainId !== c.id).map(c =>
                                    <StyledButton key={`chain-${c.id}`} className="effect-button" onClick={() => handleSwitch(c)}>
                                        <NetworkLogo network={c} />
                                        {c.name}
                                    </StyledButton>
                                )
                            }
                            <StyledButton className="effect-button" onClick={() => router.push('/profile?address=me')}>
                                <WalletIcon />
                                My Profile
                            </StyledButton>
                            <StyledButton className="effect-button" onClick={() => appKit?.disconnect()}>
                                <LogoutIcon sx={{ color: "white" }} />
                                Disconnect
                            </StyledButton>
                        </div>
                        {/* <SettingsIcon sx={{ color: "white", ml: 1 }} /> */}
                    </StyledDropdownButton>
                    : <StyledButton onClick={() => appKit?.open({ view: 'Connect' })} className="effect-button">
                        <WalletIcon />
                        Connect Wallet
                    </StyledButton>
                }
            </Box>
        </HeaderBox>
        {
            isDashboard && 
            <TradesBox display="flex" width="100%" mt="30px" px="60px" className="gradient" ref={slider}>
                {
                    trades?.length > 0 &&
                    <ScrollBox display="flex" count={count}>
                        {
                            new Array(count + 1).fill(0).map((_, i) =>
                                <Box key={`lasttrade-${i}`} flex={1} display="flex" gap="8px" alignItems="center"
                                    onClick={() => trades[i]?.tokenAddress && router.push(`/token?network=${trades[i].network}&address=${trades[i].tokenAddress}`)}
                                    sx={{ cursor: trades[i]?.tokenAddress ? 'pointer' : 'default' }}>
                                    <TokenLogo logo={trades[i]?.tokenImage} size={48} />
                                    <Box>
                                        <Typography color="white" fontSize={14} fontWeight={700}>{trades[i]?.tokenSymbol}</Typography>
                                        <Typography color={trades[i]?.type === "SELL" ? "#EF4444" : "#10B981"} fontSize={10} fontWeight={600}>{trades[i]?.type} {priceFormatter(trades[i]?.tokenAmount ?? 0, 2, true, true)}</Typography>
                                        <Typography color="#AAA" fontSize={10}>{trades[i]?.tokenAddress?.slice(0, 6)}...{trades[i]?.tokenAddress?.slice(-4)}</Typography>
                                    </Box>
                                </Box>
                            )
                        }
                    </ScrollBox>
                }
                {
                    trades?.length > 0 &&
                    <ScrollBox display="flex" count={count}>
                        {
                            new Array(count + 1).fill(0).map((_, i) => {
                                const t = trades[i+count] ?? trades[0]
                                return (
                                <Box key={`lasttrade-${i+4}`} flex={1} display="flex" gap="8px" alignItems="center"
                                    onClick={() => t?.tokenAddress && router.push(`/token?network=${t.network}&address=${t.tokenAddress}`)}
                                    sx={{ cursor: t?.tokenAddress ? 'pointer' : 'default' }}>
                                    <TokenLogo logo={t?.tokenImage} size={48} />
                                    <Box>
                                        <Typography color="white" fontSize={14} fontWeight={700}>{t?.tokenSymbol}</Typography>
                                        <Typography color={t?.type === "SELL" ? "#EF4444" : "#10B981"} fontSize={10} fontWeight={600}>{t?.type} {priceFormatter(t?.tokenAmount ?? 0, 2, true, true)}</Typography>
                                        <Typography color="#AAA" fontSize={10}>{t?.tokenAddress?.slice(0, 6)}...{t?.tokenAddress?.slice(-4)}</Typography>
                                    </Box>
                                </Box>
                                )
                            })
                        }
                    </ScrollBox>
                }
            </TradesBox>
        }
        <DialogHowItWorks open={modal === 'how'} onClose={() => setModal(undefined)} />
        {/* <appkit-modal class="appkit-modal" /> */}
    </>
}