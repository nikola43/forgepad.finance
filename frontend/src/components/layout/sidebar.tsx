import imgLogo from '../../assets/images/logo.png';
import TelegramIcon from '../../assets/images/telegram.svg';
import TwitterIcon from '../../assets/images/x.svg';
import LogoutIcon from '@mui/icons-material/Logout';
import styled, { useTheme } from "styled-components";
import { ETHISM_TELEGRAM_URL, ETHISM_TWITTER_URL } from "@/config";
import { Box, Dialog, DialogContent, DialogTitle, Typography, useMediaQuery } from "@mui/material";
import { useState } from "react";
import Link from 'next/link';
import Image from 'next/image';
import { useAppKit, useAppKitAccount, useDisconnect } from '@reown/appkit/react';
import imgForge3 from '@/assets/images/forge3.png'
import imgForge4 from '@/assets/images/forge4.png'
import CloseIcon from "@mui/icons-material/Close";
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

interface Props {
  minimized: boolean
  setMinimize: (m: boolean) => void
}

const Title = styled.div`
  font-size: 24px;
  font-weight: bold;
  color: white;
  text-align: center;
  margin-bottom: 20px;
  letter-spacing: 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 15px;
  margin-top: 20px;
`

const Logo = styled.div`
  margin-top: 10px;
  display: flex;
  align-items: center;
  span {
    color: white;
    display: block;
    font-size: 21px;
    font-weight: 700;
    border: none;
  }
  text-decoration: none !important;
`

const SocialLinks = styled.div<{ vertical?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  a {
    background: white;
    border-radius: 8px;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    img {
      filter: invert(1);
    }
    &:hover {
      opacity: 0.7;
    }
  }
  ${({ vertical }) => vertical ? `
    margin-top: auto;
    width: 100%;
    padding-bottom: 24px;
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
    a {
      width: 100%;
    }
  ` : ''}
`

const LogoWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  height: 320px;
`

const Minimize = styled.button`
  background: transparent;
  border: none;
  outline: none;
  position: absolute;
  right: 10px;
  top: 40px;
  cursor: pointer;
  &:hover {
    opacity: 0.7;
  }
`

const Maximize = styled.button`
  background: transparent;
  border: none;
  outline: none;
  cursor: pointer;
  align-self: flex-end;
  transform: scaleX(-1);
  &:hover {
    opacity: 0.7;
  }
`

const Buttons = styled.div`
  padding: 15px 15px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Button = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #FFA600;
  border: none;
  outline: none;
  border-radius: 8px;
  color: black;
  font-family: "Londrina Solid";
  font-size: 24px;
  cursor: pointer;
  transition: all 0.3s ease;
  width: 100%;
  justify-content: flex-start;
  font-weight: 400;
  
  svg {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
`

const StyledLink = styled(Link)`
  width: 100%;
  text-decoration: none;
  color: inherit;
  outline: none;
`

const HowDialog = styled(Dialog)`
  & .MuiDialog-paper {
    max-width: 700px;
    padding-top: 24px;
  }
`

const CloseButton = styled.button`
    width: 30px;
    height: 30px;
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

export const HomeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z" fill="currentColor" />
  </svg>
)

export const WalletIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M21 7.28V5C21 3.9 20.1 3 19 3H5C3.89 3 3 3.9 3 5V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V16.72C21.59 16.37 22 15.74 22 15V9C22 8.26 21.59 7.63 21 7.28ZM20 9V15H13V9H20ZM5 19V5H19V7H13C11.9 7 11 7.9 11 9V15C11 16.1 11.9 17 13 17H19V19H5Z" fill="currentColor" />
    <circle cx="16" cy="12" r="1.5" fill="currentColor" />
  </svg>
)

export const CubeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.89 3L14.85 3.91L16.11 5.73L17.73 6.89L18.64 8.85L19.37 11H4.63L5.36 8.85L6.27 6.89L7.89 5.73L9.15 3.91L11.11 3H12.89ZM5.05 13H18.95L18.22 15.15L17.31 17.11L15.69 18.27L14.43 20.09L12.47 21H11.53L9.57 20.09L8.31 18.27L6.69 17.11L5.78 15.15L5.05 13Z" fill="currentColor" />
  </svg>
)

export const TokenIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
    <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="2" fill="none" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
  </svg>
)

export const DialogHowItWorks = ({ open, onClose }: { open: boolean, onClose: () => void }) => {
  const isMobile = useMediaQuery('(max-width: 800px)')

  return <HowDialog
    open={open}
    keepMounted
    onClose={onClose}
  >
    <DialogContent>
      {
        isMobile
        ? <Image src={imgForge3} width={431} height={22} style={{ maxWidth: "100%" }} alt="" />
        : <Box display="flex" justifyContent="space-between" alignItems="center">
          <Image src={imgForge3} width={431} height={22} alt="" />
          <CloseButton onClick={onClose}>
              <CloseIcon style={{ color: "#FF9D00" }} />
          </CloseButton>
        </Box>
      }
      <Box display="flex" flexDirection="column" gap="16px" alignItems="center" pt="16px" fontFamily="Arial">
        <Image src={imgForge4} width={isMobile ? 300 : 351} height={isMobile ? 160 : 198} alt="logo" />
        <Box display="flex" flexDirection={["column", "column", "row"]} gap="8px" alignItems="center">
          <Typography textTransform="uppercase" fontFamily="Londrina Solid" fontSize={24}>💡 idea</Typography>
          { isMobile ? <ArrowDownwardIcon /> : <ArrowForwardIcon /> }
          <Typography textTransform="uppercase" fontFamily="Londrina Solid" fontSize={24}>🧪 token</Typography>
          { isMobile ? <ArrowDownwardIcon /> : <ArrowForwardIcon /> }
          <Typography textTransform="uppercase" fontFamily="Londrina Solid" fontSize={24}>🏛️ conviction</Typography>
          { isMobile ? <ArrowDownwardIcon /> : <ArrowForwardIcon /> }
          <Typography textTransform="uppercase" fontFamily="Londrina Solid" fontSize={24}>🧑 cult classic</Typography>
        </Box>
        <Typography textTransform="uppercase" fontFamily="Londrina Solid" fontSize={24}>repeat until decentralized.</Typography>
        <Button style={{ justifyContent: 'center' }} onClick={onClose}>Let's START</Button>
      </Box>
    </DialogContent>
  </HowDialog>
}

function Sidebar({ minimized, setMinimize }: Props) {
  const { open } = useAppKit()
  const [modal, setModal] = useState<string>()

  const { isConnected } = useAppKitAccount()
  const { disconnect } = useDisconnect()

  if (minimized)
    return <div className="sidebar minimized">
      <Logo as={Link} href="/">
        <Image src={imgLogo} height={90} alt="logo" />
      </Logo>
      <Maximize onClick={() => setMinimize(false)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7.51989 6.35334L5.87322 8L7.51989 9.64667C7.5857 9.70778 7.63382 9.78552 7.65916 9.87169C7.6845 9.95785 7.68613 10.0493 7.66389 10.1363C7.64164 10.2233 7.59633 10.3027 7.53274 10.3661C7.46915 10.4295 7.38963 10.4746 7.30255 10.4967C7.21564 10.5189 7.12432 10.5174 7.03821 10.4922C6.9521 10.4669 6.87438 10.419 6.81322 10.3533L4.81322 8.35334C4.71959 8.25959 4.66699 8.1325 4.66699 8C4.66699 7.8675 4.71959 7.74042 4.81322 7.64667L6.81322 5.64667C6.87433 5.58085 6.95207 5.53274 7.03823 5.5074C7.1244 5.48205 7.21581 5.48042 7.30282 5.50267C7.38984 5.52492 7.46924 5.57022 7.53267 5.63382C7.5961 5.69741 7.6412 5.77693 7.66322 5.864C7.6855 5.95092 7.68394 6.04223 7.65872 6.12834C7.6335 6.21445 7.58554 6.29217 7.51989 6.35334Z" fill="white" stroke="white" />
          <path d="M2.49992 1.33334H13.4999C14.1439 1.33334 14.6666 1.856 14.6666 2.5V13.5C14.6666 13.8094 14.5437 14.1062 14.3249 14.325C14.1061 14.5438 13.8093 14.6667 13.4999 14.6667H2.49992C2.1905 14.6667 1.89375 14.5438 1.67496 14.325C1.45617 14.1062 1.33325 13.8094 1.33325 13.5V2.5C1.33325 1.856 1.85592 1.33334 2.49992 1.33334ZM2.33325 2.5V13.5C2.33325 13.592 2.40792 13.6667 2.49992 13.6667H9.99992V2.33334H2.49992C2.45572 2.33334 2.41332 2.3509 2.38207 2.38215C2.35081 2.41341 2.33325 2.4558 2.33325 2.5ZM10.9999 13.6667H13.4999C13.5441 13.6667 13.5865 13.6491 13.6178 13.6179C13.649 13.5866 13.6666 13.5442 13.6666 13.5V2.5C13.6666 2.4558 13.649 2.41341 13.6178 2.38215C13.5865 2.3509 13.5441 2.33334 13.4999 2.33334H10.9999V13.6667Z" fill="white" stroke="white" />
        </svg>
      </Maximize>
      <Buttons>
        <StyledLink href="/" title="Home">
          <Button className="effect-button">
            <HomeIcon />
          </Button>
        </StyledLink>
        {
          !isConnected &&
          <Button onClick={() => open()} className="effect-button" title="Connect Wallet">
            <WalletIcon />
          </Button>
        }

        <Button className="effect-button" title="How it works" onClick={() => setModal('how')}>
          <CubeIcon />
        </Button>

        <Link href="/forge" style={{ textDecoration: 'none' }} title="Create Token" >
          <Button className="effect-button">
            <TokenIcon />
          </Button>
        </Link>

        {
          isConnected &&
          <Button onClick={() => disconnect()} className="effect-button" title="Disconnect Wallet">
            <LogoutIcon />
          </Button>
        }
      </Buttons>

      <SocialLinks vertical>
        <Link href={ETHISM_TELEGRAM_URL} target="_blank">
          <Image src={TelegramIcon} width={24} height={24} alt="telegramCommunity" />
        </Link>
        <Link href={ETHISM_TWITTER_URL} target="_blank">
          <Image src={TwitterIcon} width={20} height={20} alt="twitter" />
        </Link>
      </SocialLinks>

      <DialogHowItWorks open={modal === 'how'} onClose={() => setModal(undefined)} />
    </div>

  return (
    <div className="sidebar">
      <Title>ETHISM</Title>

      <Logo as={Link} href="/">
        <Image src={imgLogo} height={90} alt="logo" />
        <span>Ethism</span>
      </Logo>

      <Buttons>
        <StyledLink href="/">
          <Button className="effect-button">
            <HomeIcon />
            Home
          </Button>
        </StyledLink>

        {
          !isConnected &&
          <Button onClick={() => open()} className="effect-button">
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
          <Button onClick={() => disconnect()} className="effect-button">
            <LogoutIcon />
            Disconnect
          </Button>
        }
      </Buttons>

      <LogoWrapper>
        <Image src={imgLogo} style={{ alignSelf: 'center', objectFit: 'cover' }} width={422} height={388} alt="logo" />
      </LogoWrapper>

      <SocialLinks>
        <Link href={ETHISM_TELEGRAM_URL} target="_blank">
          <Image src={TelegramIcon} width={24} height={24} alt="telegramCommunity" />
        </Link>
        <Link href={ETHISM_TWITTER_URL} target="_blank">
          <Image src={TwitterIcon} width={20} height={20} alt="twitter" />
        </Link>
      </SocialLinks>

      <Minimize onClick={() => setMinimize(true)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7.51989 6.35334L5.87322 8L7.51989 9.64667C7.5857 9.70778 7.63382 9.78552 7.65916 9.87169C7.6845 9.95785 7.68613 10.0493 7.66389 10.1363C7.64164 10.2233 7.59633 10.3027 7.53274 10.3661C7.46915 10.4295 7.38963 10.4746 7.30255 10.4967C7.21564 10.5189 7.12432 10.5174 7.03821 10.4922C6.9521 10.4669 6.87438 10.419 6.81322 10.3533L4.81322 8.35334C4.71959 8.25959 4.66699 8.1325 4.66699 8C4.66699 7.8675 4.71959 7.74042 4.81322 7.64667L6.81322 5.64667C6.87433 5.58085 6.95207 5.53274 7.03823 5.5074C7.1244 5.48205 7.21581 5.48042 7.30282 5.50267C7.38984 5.52492 7.46924 5.57022 7.53267 5.63382C7.5961 5.69741 7.6412 5.77693 7.66322 5.864C7.6855 5.95092 7.68394 6.04223 7.65872 6.12834C7.6335 6.21445 7.58554 6.29217 7.51989 6.35334Z" fill="white" stroke="white" />
          <path d="M2.49992 1.33334H13.4999C14.1439 1.33334 14.6666 1.856 14.6666 2.5V13.5C14.6666 13.8094 14.5437 14.1062 14.3249 14.325C14.1061 14.5438 13.8093 14.6667 13.4999 14.6667H2.49992C2.1905 14.6667 1.89375 14.5438 1.67496 14.325C1.45617 14.1062 1.33325 13.8094 1.33325 13.5V2.5C1.33325 1.856 1.85592 1.33334 2.49992 1.33334ZM2.33325 2.5V13.5C2.33325 13.592 2.40792 13.6667 2.49992 13.6667H9.99992V2.33334H2.49992C2.45572 2.33334 2.41332 2.3509 2.38207 2.38215C2.35081 2.41341 2.33325 2.4558 2.33325 2.5ZM10.9999 13.6667H13.4999C13.5441 13.6667 13.5865 13.6491 13.6178 13.6179C13.649 13.5866 13.6666 13.5442 13.6666 13.5V2.5C13.6666 2.4558 13.649 2.41341 13.6178 2.38215C13.5865 2.3509 13.5441 2.33334 13.4999 2.33334H10.9999V13.6667Z" fill="white" stroke="white" />
        </svg>
      </Minimize>

      <DialogHowItWorks open={modal === 'how'} onClose={() => setModal(undefined)} />
    </div>
  );
}

export default Sidebar;