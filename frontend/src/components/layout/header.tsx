import { Avatar, Box, CircularProgress, Dialog, InputAdornment, InputBase, TextField, Typography, useMediaQuery } from "@mui/material"
import Image from "next/image"
import Link from "next/link"
import styled, { keyframes } from "styled-components"
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CubeIcon, DialogHowItWorks, HomeIcon, TokenIcon, WalletIcon } from "./sidebar";
import { CaipNetwork, useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitState, useDisconnect, useWalletInfo } from "@reown/appkit/react";
import { AssetUtil, ChainController } from "@reown/appkit-controllers"
import LogoutIcon from '@mui/icons-material/Logout';
import { User, UserName, getProfilePic } from "../cards/user";
import { useAccount } from "@/hooks/user";
import { useMainContext } from "@/context";
import { AppKitNetwork } from "@reown/appkit/networks";
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import TwitterIcon from '@/assets/images/x.svg';
import { FYUZ_TWITTER_URL } from "@/config";
import { FyuzLockup, FyuzSymbol } from "../brand/FyuzMark";
import TokenLogo from "../tokenLogo";
import { useTokens } from "@/hooks/token";
import { priceFormatter } from "@/utils/price";

const HeaderBox = styled(Box)`
    position: fixed;
    top: 0;
    left: var(--sidebar-w, 0px);
    right: 0;
    transition: left 0.2s ease;
    max-height: 64px;
    z-index: 3;
    background: var(--moss-black);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 16px;
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
    background: var(--citron);
    border: none;
    border-radius: 10px;
    color: var(--moss-black);
    font-size: 14px;
    font-family: var(--font-body);
    font-weight: 700;
    line-height: 20px;
    letter-spacing: 0;
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: center;
    transition: background-color var(--micro) var(--ease-out), transform var(--micro) var(--ease-out);
    &:hover {
        background: var(--accent-light);
    }
    &:active {
        transform: scale(0.98);
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
            background: var(--surface-dark);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: var(--shadow-lg);
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
            font-family: var(--font-body);
            font-size: 13px;
            font-weight: 500;
            background: none;
            border-radius: 8px;
            border: none;
            color: var(--text-secondary);
            width: 100%;
            justify-content: flex-start;
            height: 36px;
            position: relative;
            z-index: 1;
            &:hover {
                background: rgba(234, 230, 218, 0.06);
                color: var(--bone);
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
        background: rgba(234, 230, 218, 0.04);
        border: 1px solid var(--border);
        font-size: 14px;
        transition: background-color var(--micro) var(--ease-out), border-color var(--micro) var(--ease-out);

        input {
            padding: 8px 12px;
            font-family: var(--font-body);
            font-size: 14px;
            color: var(--bone);
            &::placeholder {
                color: rgba(234, 230, 218, 0.3);
            }
        }

        &:hover, &.Mui-focused {
            border-color: var(--border-hover);
            background: rgba(234, 230, 218, 0.06);
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
        backgroundColor: "rgba(234, 230, 218, 0.06)",
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
    const searchRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setSwitching(false)
    }, [caipNetwork])

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
                <Link href="/" aria-label="Fyuz — home">
                    <FyuzSymbol size={34} />
                </Link>
                <Link href="/create" style={{ textDecoration: "none", marginLeft: "auto", marginRight: "60px" }}>
                    <StyledButton className="effect-button" onClick={() => setModal('how')} style={{ height: "40px" }}>
                        <TokenIcon />
                        Make a Match
                    </StyledButton>
                </Link>
            </HeaderBox>
            {
                isDashboard &&
                <>
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
                                background: '#1E1C10',                                border: '1px solid rgba(234,230,218,0.08)',
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
                                            '&:hover': { background: 'rgba(234,230,218,0.06)' }
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
                <Link href="/" aria-label="Fyuz — home" style={{ flex: 'none' }}>
                    <FyuzLockup size={26} />
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
                            background: '#1E1C10',                            border: '1px solid rgba(234,230,218,0.08)',
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
                                        '&:hover': { background: 'rgba(234,230,218,0.06)' }
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
                    <Link href={FYUZ_TWITTER_URL} target="_blank"><Image src={TwitterIcon} width={50} height={35} alt="twitter" /></Link>
                </SocialLinks>
                <Link href="/create" style={{ textDecoration: "none" }}>
                    <StyledButton className="effect-button">
                        <TokenIcon />
                        Make a Match
                    </StyledButton>
                </Link>
                {
                    isConnected
                    ? <StyledDropdownButton ref={dropdownRef}>
                        <StyledButton className="effect-button" onClick={() => appKit?.open({ view: 'Networks' })}>
                            {/* The user's profile picture, not the wallet vendor's icon —
                                this button is the user's identity in the chrome. */}
                            <Avatar src={getProfilePic(account, address)} sx={{ width: 24, height: 24 }} />
                            <UserName
                                user={account}
                                address={address}
                                me
                                mr={0}
                                fontSize="12px"
                                color="#131208"
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
        <DialogHowItWorks open={modal === 'how'} onClose={() => setModal(undefined)} />
        {/* <appkit-modal class="appkit-modal" /> */}
    </>
}