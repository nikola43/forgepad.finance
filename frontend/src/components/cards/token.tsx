import { Avatar, Box, Menu, MenuItem, Typography, styled } from "@mui/material";
// import marketcapIcon from '@/assets/images/marketcap.png';
// import { priceFormatter } from "../tvchart/chart";
import { CreatorAvatar, CreatorName } from "./user";
import { API_ENDPOINT } from "@/config";
import React, { useCallback, useMemo } from "react";
// import { useUserInfo } from "../../hooks/user";
import axios from "axios";
// import { toast } from "react-toastify";
import TelegramIcon from '@/assets/images/telegram.svg';
import TwitterIcon from '@/assets/images/x.svg';
import WebsiteIcon from '@/assets/images/website.svg';
import SchoolIcon from '@mui/icons-material/School';
import WhatshotIcon from '@mui/icons-material/Whatshot';
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
  border: 1px solid rgba(234, 230, 218, 0.05);
  background: var(--surface-dark);
  overflow: hidden;
  height: 100%;
  box-sizing: border-box;
  gap: 8px;
  display: flex;
  flex-direction: column;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: var(--shadow-sm);

  ${({ theme }) => theme.breakpoints.down("sm")} {
    padding: 12px;
  }

  &:hover {
    border-color: rgba(191, 209, 67, 0.35);
  }

  &:active {
    transform: scale(0.98);
  }
  z-index: 1;
`;

// The bonding-curve "Title Shot" bar — fill is citron; champion (tangerine) is
// reserved for the graduated state and isn't reached here.
function TitleShotBar({ value }: { value: number }) {
  return (
    <Box className="title-shot-bar" sx={{ mt: '0.5rem', ml: '1em', mr: '2em', mb: '0.8em' }}>
      <Box className="title-shot-bar__fill" sx={{ width: `${value}%` }} />
    </Box>
  );
}

const PriceChange = styled(Typography)<{ negative?: "true", ends?: "true" }>`
  color: ${({ negative }) => negative ? "#D64545" : "#3FA968" };
  background: ${({ negative }) =>
    negative
      ? "rgba(214, 69, 69, 0.1)"
      : "rgba(63, 169, 104, 0.1)"
  };
  border: 1px solid ${({ negative }) => negative ? "rgba(214, 69, 69, 0.15)" : "rgba(63, 169, 104, 0.15)" };
  border-radius: ${({ ends: right }) => right ? "8px 0 0 8px" : "0 8px 8px 0" };
  width: fit-content;
  padding: 3px 10px;
  position: relative;
  font-family: var(--font-data);
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
          {token.launchedAt && (
            <span className="badge-graduated" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <SchoolIcon sx={{ fontSize: 12 }} /> Graduated
            </span>
          )}
          {Number(token.progress ?? 0) > 70 && !token.launchedAt && (
            <span className="badge-trending" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <WhatshotIcon sx={{ fontSize: 12 }} /> Hot
            </span>
          )}
          {trendIndex != null && trendIndex <= 2 && (
            <Typography fontSize={10} fontWeight={700} color="var(--citron)" sx={{
              background: 'rgba(191, 209, 67, 0.1)',
              border: '1px solid rgba(191, 209, 67, 0.2)',
              borderRadius: '100px',
              px: 1,
              py: 0.25,
              fontFamily: 'var(--font-data)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}>
              #{trendIndex + 1} Trending
            </Typography>
          )}
        </Box>
        <PriceChange negative={token.priceChange < 0 ? "true" : undefined} fontSize={10} left="-16px">
          {token.priceChange ? token.priceChange > 0 ? '+' : '-' : ''}{Math.abs(Number(token.priceChange ?? 0)).toFixed(2)}%
        </PriceChange>
        <Box flex={1}>
          <Typography color="#EAE6DA" fontSize={14} fontWeight="bold">
            {token.tokenName.length > 20 ? `${token.tokenName.substring(0, 10)}...` : token.tokenName}
          </Typography>
          <Typography className="specimen-label">
            {token.tokenSymbol.length > 20 ? `${token.tokenSymbol.substring(0, 10)}...` : token.tokenSymbol}
          </Typography>
          {token.tokenDescription && (
            <Typography color="var(--text-muted)" fontSize={11} noWrap sx={{ maxWidth: '100%' }}>
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
            <Box display="flex" alignItems="center" gap="6px">
              <CreatorAvatar token={token} size={18} mr="0" />
              <CreatorName token={token} size="16px" fontSize={12} />
            </Box>
          </Box>
          <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={0.5}>
            <Typography color="#B5B7AC" fontSize={12}>
              Market cap:
            </Typography>
            <Typography color="#B5B7AC" fontSize={12} fontFamily="var(--font-data)">
              ${priceFormatter(token.marketcap, 2)}
            </Typography>
          </Box>
          {token.holderCount && (
            <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={0.5}>
              <Typography color="#B5B7AC" fontSize={12}>Holders:</Typography>
              <Typography color="#B5B7AC" fontSize={12} fontFamily="var(--font-data)">{token.holderCount ?? '—'}</Typography>
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
        {token.launchedAt && (
          <span className="badge-graduated" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <SchoolIcon sx={{ fontSize: 12 }} /> Graduated
          </span>
        )}
        {Number(token.progress ?? 0) > 70 && !token.launchedAt && (
          <span className="badge-trending" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <WhatshotIcon sx={{ fontSize: 12 }} /> Hot
          </span>
        )}
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
            <Typography color="#EAE6DA" fontSize={14} fontWeight="bold">
              {token.tokenName.length > 20 ? `${token.tokenName.substring(0, 10)}...` : token.tokenName}
            </Typography>
            <Typography className="specimen-label">
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
          <Typography color="var(--text-muted)" fontSize={10} ml={1} mt={0.5} fontFamily="var(--font-data)">
            <TimeDiff time={new Date(token.createdAt)} postfix="ago" />
          </Typography>
          <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={1} ml={1}>
            <Typography color="#B5B7AC" fontSize={12}>
              Created by:
            </Typography>
            <Box display="flex" alignItems="center" gap="6px">
              <CreatorAvatar token={token} size={18} mr="0" />
              <CreatorName token={token} size="16px" fontSize={12} />
            </Box>
          </Box>
          <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={0.5} ml={1}>
            <Typography color="#B5B7AC" fontSize={12}>
              Market cap:
            </Typography>
            <Typography color="#B5B7AC" fontSize={12} fontFamily="var(--font-data)">
              ${priceFormatter(token.marketcap, 2)}
            </Typography>
          </Box>
          {token.holderCount && (
            <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={0.5} ml={1}>
              <Typography color="#B5B7AC" fontSize={12}>Holders:</Typography>
              <Typography color="#B5B7AC" fontSize={12} fontFamily="var(--font-data)">{token.holderCount ?? '—'}</Typography>
            </Box>
          )}
          {token.volume && (
            <Box display="flex" gap="8px" alignItems="center" justifyContent="space-between" mt={0.5} ml={1}>
              <Typography color="#B5B7AC" fontSize={12}>Volume:</Typography>
              <Typography color="#B5B7AC" fontSize={12} fontFamily="var(--font-data)">${priceFormatter(token.volume, 2, true, true)}</Typography>
            </Box>
          )}
          {
            !token.launchedAt &&
            <Box className={Number(token.progress ?? 0) > 85 ? 'graduation-glow' : ''} sx={{ borderRadius: '100px' }}>
              <TitleShotBar value={Number(token.progress ?? 0)} />
            </Box>
          }
        </Box>
      </Box>
      {token.launchedAt && (
        <Box display="flex" gap="6px" alignItems="center" alignSelf="center" sx={{
          background: 'rgba(232, 106, 43, 0.1)',
          border: '1px solid rgba(232, 106, 43, 0.2)',
          borderRadius: '100px',
          px: 1.5,
          py: 0.5,
        }}>
          <SchoolIcon sx={{ fontSize: 14, color: 'var(--tangerine)' }} />
          <Typography fontSize={11} fontWeight={600} color="var(--tangerine)" fontFamily="var(--font-data)" textTransform="uppercase" letterSpacing="1px">Graduated to DEX</Typography>
        </Box>
      )}
    </StyledCard>
  );
}

export default TokenCard;
