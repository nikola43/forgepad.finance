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
import { TimeDiff } from "@/components/time";

const StyledCard = styled(Box)`
  position: relative;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(13, 13, 20, 0.6);
  backdrop-filter: blur(12px);
  overflow: hidden;
  height: 100%;
  box-sizing: border-box;
  gap: 8px;
  display: flex;
  flex-direction: column;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);

  ${({ theme }) => theme.breakpoints.down("sm")} {
    padding: 12px;
  }

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(135deg, rgba(255, 166, 0, 0.4), rgba(139, 92, 246, 0.3));
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
  }

  &:hover {
    transform: translateY(-4px);
    border-color: rgba(255, 166, 0, 0.2);
    box-shadow:
      0 12px 32px rgba(0, 0, 0, 0.4),
      0 0 40px rgba(255, 166, 0, 0.06);
    background: rgba(16, 16, 24, 0.8);

    &::before {
      opacity: 1;
    }
  }

  &:active {
    transform: translateY(-2px);
  }
  z-index: 1;
`;

const Progress = styled('div') <{ value: number }>`
  margin-top: 0.5rem;
  margin-left: 1em;
  margin-right: 2em;
  margin-bottom: 0.8em;
  height: 4px;
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
    background: linear-gradient(90deg, #FFA600 0%, #FFD700 100%);
    box-shadow: 0 0 12px rgba(255, 166, 0, 0.4);
    transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    border-radius: 100px;
  }
`

const PriceChange = styled(Typography)<{ negative?: "true", ends?: "true" }>`
  color: ${({ negative }) => negative ? "#EF4444" : "#10B981" };
  background: ${({ negative }) =>
    negative
      ? "rgba(239, 68, 68, 0.1)"
      : "rgba(16, 185, 129, 0.1)"
  };
  border: 1px solid ${({ negative }) => negative ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.15)" };
  border-radius: ${({ ends: right }) => right ? "8px 0 0 8px" : "0 8px 8px 0" };
  width: fit-content;
  padding: 3px 10px;
  position: relative;
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.02em;
  transition: all 0.2s ease;
`

function TokenCard({ token, mode, trendIndex, ...props }: any) {
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
      <StyledCard {...props} className="effect-button card-enter" p="16px" alignItems="stretch" onClick={() => router.push(`/token?network=${token.network}&address=${token.tokenAddress}`)}>
        <Box mx="auto" position="relative">
          <TokenLogo logo={token.tokenImage} size="150px" style={{ borderRadius: '8px' }} />
        </Box>
        <Image src={`/networks/${token.network}.svg`} width={24} height={24} alt="" style={{ position: "absolute", top: 8, right: 8 }} />
        {/* Status badges */}
        <Box position="absolute" top={8} right={40} display="flex" gap="4px" alignItems="center">
          {token.launchedAt && <span className="badge-graduated">Graduated</span>}
          {Number(token.progress ?? 0) > 70 && !token.launchedAt && <span className="badge-trending">🔥 Hot</span>}
          {trendIndex != null && trendIndex <= 2 && (
            <Typography fontSize={10} fontWeight={700} color="#FFD700" sx={{
              background: 'rgba(255, 215, 0, 0.1)',
              border: '1px solid rgba(255, 215, 0, 0.2)',
              borderRadius: '100px',
              px: 1,
              py: 0.25,
            }}>
              #{trendIndex + 1} Trending
            </Typography>
          )}
        </Box>
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
          {token.tokenDescription && (
            <Typography color="#64748B" fontSize={11} noWrap sx={{ maxWidth: '100%' }}>
              {token.tokenDescription}
            </Typography>
          )}
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
          {token.holderCount && (
            <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={0.5}>
              <Typography color="#B5B7AC" fontSize={12}>Holders:</Typography>
              <Typography color="#B5B7AC" fontSize={12}>{token.holderCount ?? '—'}</Typography>
            </Box>
          )}
        </Box>
      </StyledCard>
    )
  }

  return (
    <StyledCard {...props} className="effect-button card-enter" p="8px 16px 8px 8px" onClick={() => router.push(`/token?network=${token.network}&address=${token.tokenAddress}`)}>
      {/* Status badges */}
      <Box position="absolute" top={8} right={8} display="flex" gap="4px" alignItems="center" zIndex={2}>
        {token.launchedAt && <span className="badge-graduated">Graduated</span>}
        {Number(token.progress ?? 0) > 70 && !token.launchedAt && <span className="badge-trending">🔥 Hot</span>}
      </Box>
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
          <Typography color="#64748B" fontSize={10} ml={1} mt={0.5}>
            <TimeDiff time={new Date(token.createdAt)} postfix="ago" />
          </Typography>
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
          {token.holderCount && (
            <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={0.5} ml={1}>
              <Typography color="#B5B7AC" fontSize={12}>Holders:</Typography>
              <Typography color="#B5B7AC" fontSize={12}>{token.holderCount ?? '—'}</Typography>
            </Box>
          )}
          {token.volume && (
            <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={0.5} ml={1}>
              <Typography color="#B5B7AC" fontSize={12}>Volume:</Typography>
              <Typography color="#B5B7AC" fontSize={12}>${priceFormatter(token.volume, 2, true, true)}</Typography>
            </Box>
          )}
          {
            !token.launchedAt &&
            <Box className={Number(token.progress ?? 0) > 85 ? 'graduation-glow' : ''} sx={{ borderRadius: '100px' }}>
              <Progress value={Number(token.progress ?? 0)} />
            </Box>
          }
        </Box>
      </Box>
      {token.launchedAt && (
        <Box display="flex" gap="6px" alignItems="center" alignSelf="center" sx={{
          background: 'rgba(139, 92, 246, 0.1)',
          border: '1px solid rgba(139, 92, 246, 0.2)',
          borderRadius: '100px',
          px: 1.5,
          py: 0.5,
        }}>
          <Typography fontSize={11} fontWeight={600} color="#8B5CF6">✨ Graduated to DEX</Typography>
        </Box>
      )}
    </StyledCard>
  );
}

export default TokenCard;
