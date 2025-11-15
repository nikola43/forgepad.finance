import { Avatar, Box, Menu, MenuItem, Typography, styled } from "@mui/material";
// import marketcapIcon from '@/assets/images/marketcap.png';
// import { priceFormatter } from "../tvchart/chart";
import { CreatorName } from "./user";
import { API_ENDPOINT } from "@/config";
import React, { useCallback, useMemo } from "react";
// import { useUserInfo } from "../../hooks/user";
import axios from "axios";
// import { toast } from "react-toastify";
import TelegramIcon from '@/assets/images/telegram.svg';
import TwitterIcon from '@/assets/images/x.svg';
import WebsiteIcon from '@/assets/images/website.svg';
import TokenLogo from "../tokenLogo";
import Link from "next/link";
import Image from "next/image";
import { priceFormatter } from "@/utils/price";
import { useRouter } from "next/navigation";
import { useMainContext } from "@/context";

const StyledCard = styled(Box)`
  position: relative;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(20, 20, 28, 0.6);
  backdrop-filter: blur(20px) saturate(180%);
  overflow: hidden;
  height: 100%;
  box-sizing: border-box;
  gap: 8px;
  display: flex;
  flex-direction: column;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow:
    0 8px 16px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 0.03);

  ${({ theme }) => theme.breakpoints.down("sm")} {
    padding: 16px;
  }

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(135deg, rgba(255, 166, 0, 0.3), rgba(138, 43, 226, 0.3));
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0;
    transition: opacity 0.4s ease;
  }

  &:hover {
    transform: translateY(-6px) scale(1.02);
    border-color: rgba(255, 166, 0, 0.3);
    box-shadow:
      0 20px 40px rgba(255, 166, 0, 0.15),
      0 0 0 1px rgba(255, 166, 0, 0.1),
      0 0 80px rgba(255, 166, 0, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    background: rgba(25, 25, 35, 0.8);

    &::before {
      opacity: 1;
    }
  }

  &:active {
    transform: translateY(-3px) scale(1.01);
  }
  z-index: 1;
`;

const Progress = styled('div') <{ value: number }>`
  margin-top: 0.5rem;
  margin-left: 1em;
  margin-right: 2em;
  margin-bottom: 0.8em;
  height: 8px;
  background: rgba(255, 255, 255, 0.04);
  position: relative;
  border-radius: 100px;
  overflow: hidden;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);

  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 100%;
    background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.08) 50%, transparent 100%);
    animation: shimmer 2.5s infinite;
  }

  &::after {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: ${({ value }) => value}%;
    background: linear-gradient(90deg, #FFA600 0%, #FFD700 50%, #FFA600 100%);
    background-size: 200% 100%;
    animation: progressShine 3s linear infinite;
    box-shadow:
      0 0 20px rgba(255, 166, 0, 0.6),
      0 0 40px rgba(255, 166, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.3);
    transition: width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
    border-radius: 100px;
  }

  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  @keyframes progressShine {
    0% { background-position: 0% 0%; }
    100% { background-position: 200% 0%; }
  }
`

const PriceChange = styled(Typography)<{ negative?: "true", ends?: "true" }>`
  color: ${({ negative }) => negative ? "#ff5757" : "#00ffa3" };
  background: ${({ negative }) =>
    negative
      ? "linear-gradient(135deg, rgba(255, 68, 68, 0.12) 0%, rgba(255, 68, 68, 0.08) 100%)"
      : "linear-gradient(135deg, rgba(0, 255, 163, 0.12) 0%, rgba(0, 255, 163, 0.08) 100%)"
  };
  backdrop-filter: blur(10px);
  border: 1px solid ${({ negative }) => negative ? "rgba(255, 87, 87, 0.25)" : "rgba(0, 255, 163, 0.25)" };
  border-radius: ${({ ends: right }) => right ? "12px 0 0 12px" : "0 12px 12px 0" };
  width: fit-content;
  padding: 5px 12px;
  position: relative;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.02em;
  box-shadow:
    ${({ negative }) =>
      negative
        ? "0 4px 12px rgba(255, 68, 68, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
        : "0 4px 12px rgba(0, 255, 163, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
    };
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  text-shadow: ${({ negative }) =>
    negative
      ? "0 0 10px rgba(255, 68, 68, 0.5)"
      : "0 0 10px rgba(0, 255, 163, 0.5)"
  };

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: ${({ negative }) =>
      negative
        ? "linear-gradient(135deg, rgba(255, 87, 87, 0.15) 0%, transparent 100%)"
        : "linear-gradient(135deg, rgba(0, 255, 163, 0.15) 0%, transparent 100%)"
    };
  }
`

function TokenCard({ token, mode, ...props }: any) {
  const router = useRouter()
  // const { userInfo } = useUserInfo()

  // const isAdmin = useMemo(() => !!userInfo?.admin?.id, [userInfo])
  const { chains } = useMainContext()
  const chain = useMemo(() => chains?.find(c => c.network === token.network), [chains, token])

  const pool = useMemo(() => {
    if (!chain || !token)
      return undefined
    const poolFields = chain.pools[token.poolType - 1].split(':')
    return {
      name: poolFields[0], version: poolFields[1]
    }
  }, [token, chain])

  const [contextMenu, setContextMenu] = React.useState<{
    mouseX: number;
    mouseY: number;
  } | null>(null);

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu(
      contextMenu === null
        ? {
          mouseX: event.clientX + 2,
          mouseY: event.clientY - 6,
        }
        : null,
    );
  };

  const handleClose = () => {
    setContextMenu(null);
  };

  if (mode === "trends") {
    return (
      <StyledCard {...props} className="effect-button" p="16px" alignItems="stretch" onClick={() => router.push(`/token?network=${token.network}&address=${token.tokenAddress}`)}>
        <Box mx="auto" position="relative">
          <TokenLogo logo={token.tokenImage} size="150px" style={{ borderRadius: '8px' }} />
        </Box>
        <Image src={`/networks/${token.network}.svg`} width={24} height={24} alt="" style={{ position: "absolute", top: 8, right: 8 }} />
        <PriceChange negative={token.priceChange < 0 ? "true" : undefined} fontSize={10} left="-16px">
          {token.priceChange ? token.priceChange > 0 ? '+' : '-' : ''}{Math.abs(Number(token.priceChange ?? 0)).toFixed(2)}%
        </PriceChange>
        <Box flex={1}>
          <Typography color="white" fontSize={14} fontWeight="bold">
            {token.tokenName.length > 20 ? `${token.tokenName.substring(0, 10)}...` : token.tokenName}
          </Typography>
          <Typography color="#B5B7AC" fontSize={12}>
            {token.tokenSymbol.length > 20 ? `${token.tokenSymbol.substring(0, 10)}...` : token.tokenSymbol}
          </Typography>
          {/* <Box display="flex" gap="4px" alignItems="center">
            {!!token.telegramLink && <Link to={token.telegramLink} target="_blank" style={{ opacity: 0.5 }}><img src={TelegramIcon} width={16} height={16} alt="telegram" /></Link>}
            {!!token.twitterLink && <Link to={token.twitterLink} target="_blank" style={{ opacity: 0.5 }}><img src={TwitterIcon} width={16} height={16} alt="twitter" /></Link>}
            {!!token.webLink && <Link to={token.webLink} target="_blank" style={{ opacity: 0.5 }}><img src={WebsiteIcon} width={16} height={16} alt="website" /></Link>}
          </Box> */}
          <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={2}>
            <Typography color="#B5B7AC" fontSize={12}>
              Created by:
            </Typography>
            <Box display="flex" alignItems="center">
              <CreatorName token={token} size="16px" fontSize={12} />
            </Box>
          </Box>
          <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={0.5}>
            <Typography color="#B5B7AC" fontSize={12}>
              Market cap:
            </Typography>
            <Typography color="#B5B7AC" fontSize={12}>
              ${priceFormatter(token.marketcap, 2)}
            </Typography>
          </Box>
        </Box>
      </StyledCard>
    )
  }

  return (
    <StyledCard {...props} className="effect-button" p="8px 16px 8px 8px" onClick={() => router.push(`/token?network=${token.network}&address=${token.tokenAddress}`)}>
      <Box display="flex" gap="8px">
        <Box display="flex" flexDirection="column" alignItems="center" gap="8px">
          <TokenLogo logo={token.tokenImage} size="64px" style={{ margin: '4px', borderRadius: '8px' }} />
          {
            !token.launchedAt &&
            <Box display="flex" gap="8px" alignItems="center">
              <Image src={`/networks/${token.network}.svg`} width={16} height={16} alt="" />
              <Box display="flex" px="4px" justifyContent="center" alignItems="flex-end" bgcolor="white" borderRadius="10px">
                <Avatar src={`/pools/${pool?.name}.png`} sx={{ width: 16, height: 16 }} alt="unitswap" />
                <Typography fontSize={10} color="#ff1383" fontWeight="bold">{pool?.version}</Typography>
              </Box>
            </Box>
          }
        </Box>
        <Box flex={1}>
          <Box display="flex" gap="8px" alignItems="center" mt={0.5}>
            <Typography color="white" fontSize={14} fontWeight="bold">
              {token.tokenName.length > 20 ? `${token.tokenName.substring(0, 10)}...` : token.tokenName}
            </Typography>
            <Typography color="#B5B7AC" fontSize={12}>
              {token.tokenSymbol.length > 20 ? `${token.tokenSymbol.substring(0, 10)}...` : token.tokenSymbol}
            </Typography>
            <Box display="flex" gap="4px" alignItems="center" ml="auto">
              {!!token.telegramLink && <Link href={token.telegramLink} target="_blank" style={{ opacity: 0.5 }}><TelegramIcon width={16} height={16} /></Link>}
              {!!token.twitterLink && <Link href={token.twitterLink} target="_blank" style={{ opacity: 0.5 }}><Image src={TwitterIcon} width={16} height={16} alt="twitter" /></Link>}
              {!!token.webLink && <Link href={token.webLink} target="_blank" style={{ opacity: 0.5 }}><Image src={WebsiteIcon} width={16} height={16} alt="website" /></Link>}
            </Box>
            {
              !!token.priceChange &&
              <PriceChange negative={token.priceChange < 0 ? "true" : undefined} fontSize={10} ends="true" right="-16px" top="-8px">
                {token.priceChange > 0 ? '+' : '-'}{Math.abs(Number(token.priceChange)).toFixed(2)}%
              </PriceChange>
            }
          </Box>
          <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={1} ml={1}>
            <Typography color="#B5B7AC" fontSize={12}>
              Created by:
            </Typography>
            <Box display="flex" alignItems="center">
              <CreatorName token={token} size="16px" fontSize={12} />
            </Box>
          </Box>
          <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={0.5} ml={1}>
            <Typography color="#B5B7AC" fontSize={12}>
              Market cap:
            </Typography>
            <Typography color="#B5B7AC" fontSize={12}>
              ${priceFormatter(token.marketcap, 2)}
            </Typography>
          </Box>
          {
            !token.launchedAt &&
            <Progress value={Number(token.progress ?? 0)} />
          }
        </Box>
      </Box>
      {
        token.launchedAt &&
        <Box display="flex" gap="8px" alignItems="center" alignSelf="center">
          <img width={20} height={20} alt="mc" src="/images/marketcap.png" />
          <Typography color="#FBFF00" fontSize={11}>Bonding Complete and Listed on swap</Typography>
        </Box>
      }
    </StyledCard>
  );
}

export default TokenCard;
