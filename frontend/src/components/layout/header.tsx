import { Avatar, Box, CircularProgress, Dialog, InputAdornment, InputBase, TextField, Typography, useMediaQuery } from "@mui/material"
import Image from "next/image"
import Link from "next/link"
import styled, { keyframes } from "styled-components"
// import imgLogo from '@/assets/images/logo.png';
// import imgForge0 from '@/assets/images/forge0.png';
// import imgForge1 from '@/assets/images/forge1.png';
// import imgForge2 from "@/assets/images/forge2.png";
// import imgBanner from "@/assets/images/banner.png"
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CubeIcon, DialogHowItWorks, HomeIcon, TokenIcon, WalletIcon } from "./sidebar";
import { CaipNetwork, useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitState, useDisconnect, useWalletInfo } from "@reown/appkit/react";
import { AssetUtil, ChainController } from "@reown/appkit-controllers"
import LogoutIcon from '@mui/icons-material/Logout';
import { User, UserName } from "../cards/user";
import { useMainContext } from "@/context";
import { AppKitNetwork } from "@reown/appkit/networks";
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import TelegramIcon from '@/assets/images/telegram.svg';
import TwitterIcon from '@/assets/images/x.svg';
import { FORGE_TELEGRAM_URL, FORGE_TWITTER_URL } from "@/config";
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
    left: 0;
    right: 0;
    max-height: 68px;
    // overflow: hidden;
    z-index: 3;
    background: #121212;
    border-top: 1px solid #FF9D00;
    border-bottom: 1px solid #FF9D00;
    margin-top: 8px;
    display: flex;
    align-items: center;
    gap: 16px;
    &::before {
        position: fixed;
        left: 0;
        top: 0;
        right: 0;
        height: 8px;
        background: #1E1E2F;
        content: "";
    }
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
    gap: 80px;
    box-sizing: border-box;
    align-items: center;
    &.gradient::after {
        content: "";
        background: linear-gradient(90deg, #000A, #0000 150px), linear-gradient(-90deg, #000A 0%, #0000 150px);
        position: absolute;
        height: 63px;
        left: 0;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
    }
    &.gradient::before {
        content: "";
        background: radial-gradient(51.54% 206.16% at 50% 50%, #000, #0000);
        width: 400px;
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
        &:hover {
            // animation: ${beat} 0.5s linear infinite;
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
    padding: 0 24px;
    height: 42px;
    padding: 12px 16px;
    background: #FFA600;
    border: none;
    border-radius: 8px;
    color: black;
    font-size: 20px;
    font-family: "Londrina Solid";
    font-weight: 700;
    border-bottom: 3px solid white;
    line-height: 20px;
    letter-spacing: 0%;
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: center;
    &:hover {
        opacity: 0.7;
    }
    svg {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        fill: currentColor;
    }
`

const StyledDropdownButton = styled.div`
    position: relative;
    & > div {
        position: absolute;
        display: none;
        top: 100%;
        right: 0;
        &::before {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            margin-top: 4px;
            content: "";
            background: rgba(255, 255, 255, 0.1);
            border-radius: 8px;
        }
        padding: 8px 0;
        min-width: 200px;
        z-index: 3;
        ${StyledButton} {
            font-family: Inter;
            font-size: 16px;
            background: none;
            border-radius: 0;
            border: none;
            color: white;
            &:hover {
                background: rgba(255, 255, 255, 0.1);
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
        border-radius: 8px;
        border-bottom: 3px solid white;
        background: #2E2E37;
        // box-shadow: 0px 6px 8px 2px #9996 inset, 0px -4px 8px 0px #9991 inset, 0 0 10px #0008;
        font-size: 1em;
        // backdrop-filter: blur(10px);

        input {
            padding: 8px;
            font-family: "Londrina Solid";
            font-size: 18px;
        }

        &:hover {
            border-color: #AAA;
            // box-shadow: 0px 4px 4px 2px rgba(6, 182, 212, 0.2) inset, 0px -4px 8px 0px rgba(6, 182, 212, 0.1) inset, 0 0 10px #0008;
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
    const [modal, setModal] = useState<string>()

    const { appKit } = useMainContext()
    // const { open, close } = useAppKit()
    const { isConnected, address, caipAddress } = useAppKitAccount()
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
    const slider = useRef<HTMLElement>(null)

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
    }, [newTrades])

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
                    <img src="/images/forge2.png" width={54} height={54} style={{ border: "1px solid #FFA600", borderRadius: "4px" }} alt="" />
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
                                            <Typography color={trades[i]?.type === "SELL" ? "red" : "darkgreen"} fontSize={10}>{trades[i]?.type}</Typography>
                                            <Typography color="#AAA" fontSize={10}>{trades[i]?.tokenAddress?.slice(0, 6)}...{trades[i]?.tokenAddress?.slice(-4)}</Typography>
                                        </Box>
                                    </Box>
                                )
                            }
                        </ScrollBox>
                    }
                    </TradesBox>
                    <Box px="8px" mt={2}>
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
                <SearchToken
                    placeholder="Search token"
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
            </Box>
            <Box display="flex" justifyContent="center" alignItems="center" onClick={() => setModal("how")} style={{ cursor: "pointer" }}>
                <img src="/images/forge0.png" width={82} height={82} alt="logo" style={{ top: "0px", position: "relative" }} />
                <img src="/images/forge1.png" width={281} height={52} alt="logo" />
            </Box>
            <Box flex={1} display="flex" gap="18px" alignItems="center" justifyContent="flex-end">
                <SocialLinks>
                    <Link href={FORGE_TELEGRAM_URL} target="_blank"><Image src={TelegramIcon} width={50} height={35} alt="telegramCommunity" /></Link>
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
                                // user={userInfo}
                                address={address}
                                me
                                mr={0}
                                fontSize="12px"
                                color="white"
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
                                <Box key={`lasttrade-${i}`} flex={1} display="flex" gap="8px" alignItems="center">
                                    <TokenLogo logo={trades[i]?.tokenImage} size={48} />
                                    <Box>
                                        <Typography color="white" fontSize={14} fontWeight={700}>{trades[i]?.tokenSymbol}</Typography>
                                        <Typography color={trades[i]?.type === "SELL" ? "red" : "darkgreen"} fontSize={10}>{trades[i]?.type} {priceFormatter(trades[i]?.tokenAmount ?? 0, 2, true, true)}</Typography>
                                        <Typography color="#AAA" fontSize={10}>{trades[i]?.tokenAddress?.slice(0, 6)}...{trades[i]?.tokenAddress?.slice(-4)}</Typography>
                                    </Box>
                                </Box>
                            )
                        }
                    </ScrollBox>
                }
                <Link href="/forge">
                    <img src="/images/forge2.png" width={127} height={127} style={{ border: "1px solid #FFA600", borderRadius: "4px" }} alt="" className="logo" />
                </Link>
                {
                    trades?.length > 0 &&
                    <ScrollBox display="flex" count={count}>
                        {
                            new Array(count + 1).fill(0).map((_, i) => 
                                <Box key={`lasttrade-${i+4}`} flex={1} display="flex" gap="8px" alignItems="center">
                                    <TokenLogo logo={(trades[i+count] ?? trades[0])?.tokenImage} size={48} />
                                    <Box>
                                        <Typography color="white" fontSize={14} fontWeight={700}>{(trades[i+count] ?? trades[0])?.tokenSymbol}</Typography>
                                        <Typography color={(trades[i+count] ?? trades[0])?.type === "SELL" ? "red" : "darkgreen"} fontSize={10}>{(trades[i+count] ?? trades[0])?.type} {priceFormatter((trades[i+count] ?? trades[0])?.tokenAmount ?? 0, 2, true, true)}</Typography>
                                        <Typography color="#AAA" fontSize={10}>{(trades[i+count] ?? trades[0])?.tokenAddress?.slice(0, 6)}...{(trades[i+count] ?? trades[0])?.tokenAddress?.slice(-4)}</Typography>
                                    </Box>
                                </Box>
                            )
                        }
                    </ScrollBox>
                }
            </TradesBox>
        }
        <DialogHowItWorks open={modal === 'how'} onClose={() => setModal(undefined)} />
        {/* <appkit-modal class="appkit-modal" /> */}
    </>
}