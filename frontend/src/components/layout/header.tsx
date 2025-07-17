import { Avatar, Box, CircularProgress, Dialog, InputBase, useMediaQuery } from "@mui/material"
import Image from "next/image"
import Link from "next/link"
import styled from "styled-components"
import imgLogo from '@/assets/images/logo.png';
import imgBanner from "@/assets/images/banner.png"
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CubeIcon, HomeIcon, WalletIcon } from "./sidebar";
import { CaipNetwork, useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitState, useDisconnect, useWalletInfo } from "@reown/appkit/react";
import { AssetUtil, ChainController } from "@reown/appkit-controllers"
import LogoutIcon from '@mui/icons-material/Logout';
import { User, UserName } from "../cards/user";
import { useMainContext } from "@/context";
import { AppKitNetwork } from "@reown/appkit/networks";

const HeaderBox = styled.div`
    position: fixed;
    top: 0px;
    left: 0px;
    width: 100vw;
    z-index: 2;
    background: #121212;
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
    padding: 0 16px;
    height: 42px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 16px;
    font-family: Arial;
    font-weight: 400;
    font-size: 16px;
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
            background: none;
            border-radius: 0;
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

    const { open, close } = useAppKit()
    const { isConnected, address, caipAddress } = useAppKitAccount()
    const { chainId, caipNetwork, switchNetwork } = useAppKitNetwork()
    const { disconnect } = useDisconnect()
    const { walletInfo } = useWalletInfo()
    // const state = useAppKitState()

    const isDashboard = useMemo(() => pathname === '/', [pathname])
    const networks = ChainController.getCaipNetworks()
    const dropdownRef = useRef<any>(undefined)
    const [isSwitching, setSwitching] = useState(true)

    useEffect(() => {
        // console.log("network", chainId, caipNetwork)
        close()
        setSwitching(false)
    }, [caipNetwork])

    useEffect(() => {
        if (window !== undefined) {
            setScrollTop(window.scrollY)
            window.addEventListener('scroll', function () {
                setScrollTop(window.scrollY)
            })
        }
    }, [])

    const handleSwitch = (network: any) => {
        setSwitching(true)
        switchNetwork(network)
        // open({
        //     view: "Networks", namespace: network.chainNamespace, 
        // })
        dropdownRef.current.classList.add('done')
        setTimeout(() => dropdownRef.current?.classList?.remove('done'), 1000)
    }

    if (isMobile)
        return <HeaderBox>
            <Flex style={{ paddingTop: '17px', paddingRight: '15px', justifyContent: 'flex-end' }}>
                <Buttons>
                    <Link href="/forge" style={{ textDecoration: 'none' }}>
                        <StyledButton className="effect-button">Create Token</StyledButton>
                    </Link>
                    <Link href="/" style={{ textDecoration: 'none' }}>
                        <LogoWrapper style={{ width: "42px" }}>
                            <Image src={imgLogo} style={{ alignSelf: 'center', objectFit: 'cover' }} width={82} height={82} alt="logo" />
                        </LogoWrapper>
                    </Link>
                </Buttons>
            </Flex>
            {/* {
                location?.pathname !== '/forge' && tradeIndex > 0 && trades.length > 0 &&
                <Box display="flex" justifyContent="center" gap="8px" py="8px" alignItems="stretch">
                    <Trade trade={trades[tradeIndex - 1]} className="new" />
                </Box>
            } */}
        </HeaderBox>
    return <div>
        {
            isDashboard &&
            <Banner style={{ position: "fixed", height: `${Math.max(58, 139 - scrollTop)}px`, marginLeft: "16px" }}>
                <Image src={imgBanner} style={{ width: "100%", height: "100%" }} alt="" />
            </Banner>
        }
        <Flex style={{ justifyContent: "space-between", height: "130px", paddingRight: "16px" }}>
            {
                isDashboard
                    ? <div />
                    : <Banner style={{ height: 139 }}>
                        <Image src={imgBanner} style={{ width: "100%", height: "100%" }} alt="" />
                    </Banner>
            }
            <Box alignSelf="flex-start">
                <Buttons>
                    <Link href="/" style={{ textDecoration: 'none' }}>
                        <StyledButton className="effect-button">
                            <HomeIcon />
                        </StyledButton>
                    </Link>
                    <StyledButton className="effect-button" onClick={() => setModal('how')}>
                        <CubeIcon />
                        How it works
                    </StyledButton>
                    {
                        isConnected
                            ? <StyledDropdownButton ref={dropdownRef}>
                                <StyledButton className="effect-button" onClick={() => open({ view: 'Networks' })}>
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
                                    <StyledButton className="effect-button" onClick={() => disconnect()}>
                                        <LogoutIcon sx={{ color: "white" }} />
                                        Disconnect
                                    </StyledButton>
                                </div>
                                {/* <SettingsIcon sx={{ color: "white", ml: 1 }} /> */}
                            </StyledDropdownButton>
                            : <StyledButton onClick={() => open({ view: 'Connect' })} className="effect-button">
                                <WalletIcon />
                                Connect Wallet
                            </StyledButton>
                    }
                </Buttons>
            </Box>
        </Flex>
    </div>
}