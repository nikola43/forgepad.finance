import styled from "styled-components"
import CloseIcon from "@mui/icons-material/Close";
import LogoutIcon from '@mui/icons-material/Logout';
import TelegramIcon from '@/assets/images/telegram.svg';
import TwitterIcon from '@/assets/images/x.svg';
import { CubeIcon, DialogHowItWorks, HomeIcon, TokenIcon, WalletIcon } from "./sidebar";
import { FORGE_TELEGRAM_URL, FORGE_TWITTER_URL } from "@/config";
import { useEffect, useState } from "react";
import { CircularProgress } from "@mui/material";
import Link from "next/link";
import Image from "next/image";
import { useAppKit, useAppKitAccount, useAppKitNetwork, useDisconnect } from "@reown/appkit/react";
import { usePathname, useRouter } from "next/navigation";
import { useMainContext } from "@/context";

const Menu = styled.div`
    position: fixed;
    top: 22px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 3;
`

const MenuButton = styled.button`
    width: 40px;
    height: 40px;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #232325;
    border: none;
    outline: none;
    border-radius: 8px;
    color: white;
    cursor: pointer;
    
    &:hover {
        background: rgba(255, 255, 255, 0.2);
    }
`

const MenuBack = styled.div`
    background: #101012;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index:3;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 40px;
`

const MenuDropdown = styled.div`
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
        ${MenuButton} {
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

const LogoWrapper = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    height: 260px;
    margin-top: 40px;
`

const Buttons = styled.div`
    padding: 15px 15px;
    display: flex;
    flex-direction: column;
    margin-bottom: 20px;
    gap: 12px;
`

const Button = styled.button`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid #FF9D00;
    outline: none;
    border-radius: 8px;
    color: white;
    font-size: 16px;
    cursor: pointer;
    transition: all 0.3s ease;
    width: 100%;
    justify-content: flex-start;
    font-family: Arial;
    font-weight: 400;
    
    svg {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        fill: currentColor;
    }
    
    &:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: translateY(-2px);
    }
`

const StyledLink = styled(Link)`
    width: 100%;
    text-decoration: none;
    color: inherit;
    outline: none;
`

const SocialLinks = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24px;
    a {
        // background: rgba(255, 255, 255, 0.1);
        // border-radius: 8px;
        // width: 40px;
        // height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        &:hover {
            opacity: 0.7;
        }
    }
`

export default function MobileMenu({ open, onMenuOpen }: { open: boolean, onMenuOpen: (isOpen: boolean) => void }) {
    // const { open: connect,  } = useAppKit()
    const { isConnected } = useAppKitAccount()
    // const { disconnect } = useDisconnect()
    const [modal, setModal] = useState<string>()
    const pathname = usePathname()
    // const { switchNetwork } = useAppKitNetwork()

    const { appKit } = useMainContext()
    // const chain: any = undefined

    // const isSwitching = false
    // const switchChain = (c: any) => {}

    // const { chain, chains } = useChainInfo()
    // const { isSwitching, switchChain } = useSwitchChain()

    useEffect(() => {
        onMenuOpen(false)
    }, [pathname])

    if (!open)
        return <Menu>
            <MenuButton className="effect-button" onClick={() => onMenuOpen(true)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 6H4M20 12H4M20 18H4" stroke="#FF9D00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </MenuButton>
            {
                // chains?.filter((c: any) => c.chainId !== chain?.chainId).map((c: any) =>
                //     <MenuButton key={`chain-${c.chainId}`} className="effect-button" onClick={() => switchChain(c.chainId)}>
                //         {
                //             isSwitching 
                //             ? <CircularProgress color="inherit" size={20} /> 
                //             : <img src={`/networks/${c.network}.svg`} alt="" height={24} />
                //         }                        
                //     </MenuButton>
                // )
            }
        </Menu>
    return <MenuBack>
        <Menu>
            <MenuButton className="effect-button" onClick={() => onMenuOpen(false)}>
                <CloseIcon style={{ color: "#FF9D00" }} />
            </MenuButton>
        </Menu>
        <LogoWrapper>
            <img src="/images/logo.png" style={{ objectFit: 'contain' }} width={220} height={220} alt="logo" />
        </LogoWrapper>
        <Buttons>
            <StyledLink href="/">
                <Button className="effect-button">
                    <HomeIcon />
                    Home
                </Button>
            </StyledLink>

            {
                !isConnected &&
                <Button onClick={() => appKit?.open()} className="effect-button">
                    <WalletIcon />
                    Connect Wallet
                </Button>
            }

            <Button className="effect-button" onClick={() => setModal('how')}>
                <CubeIcon />
                How it works
            </Button>

            <Link href="/forge" style={{ textDecoration: 'none' }} >
                <Button className="effect-button">
                    <TokenIcon />
                    Create Token
                </Button>
            </Link>

            {
                isConnected &&
                <Button onClick={() => appKit?.disconnect()} className="effect-button">
                    <LogoutIcon />
                    Disconnect Wallet
                </Button>
            }
        </Buttons>

        <SocialLinks>
            <Link href={FORGE_TELEGRAM_URL} target="_blank">
                <Image src={TelegramIcon} width={45} height={45} alt="telegramCommunity" />
            </Link>
            <Link href={FORGE_TWITTER_URL} target="_blank">
                <Image src={TwitterIcon} width={45} height={45} alt="twitter" />
            </Link>
        </SocialLinks>

        <DialogHowItWorks open={modal === 'how'} onClose={() => setModal(undefined)} />
    </MenuBack>
}