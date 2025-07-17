import { Avatar, Box, Menu, MenuItem, Typography, styled } from "@mui/material";
import marketcapIcon from '@/assets/images/marketcap.png';
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
  border-radius: 4px;
  border: 1px solid transparent;
  background: #18181D;
  overflow: hidden;
  height: 100%;
  box-sizing: border-box;
  gap: 8px;
  display: flex;
  text-decoration: none;
  overflow: hidden;
  cursor: pointer;

  ${({ theme }) => theme.breakpoints.down("sm")} {
    padding: 16px;
  }

  &:hover {
    opacity: 0.8;
    border: 1px solid gray;
  }
  z-index: 1;
`;

const Progress = styled('div') <{ value: number }>`
  margin-top: 0.5rem;
  margin-left: 1em;
  margin-right: 2em;
  margin-bottom: 0.8em;
  height: 10px;
  background: black;
  position: relative;
  transform: skewX(-33deg);
  border-radius: 8px;
  overflow: hidden;
  &::after {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: ${({ value }) => value}%;
    background: white;
  }
`

const PriceChange = styled(Typography)<{ negative?: "true", ends?: "true" }>`
  color: ${({ negative }) => negative ? "red" : "lightgreen" };
  background: ${({ negative }) => negative ? "#FF333633" : "#6CFF3233" };
  border-radius: ${({ ends: right }) => right ? "20px 0 0 20px" : "0 20px 20px 0" };
  width: fit-content;
  padding: 2px 8px;
  position: relative;
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
      <StyledCard {...props} className="effect-button" p="16px" flexDirection="column" alignItems="stretch" onClick={() => router.push(`/${token.network}/${token.tokenAddress}`)}>
        <Box mx="auto" position="relative">
          <TokenLogo logo={token.tokenImage} size="150px" style={{ borderRadius: '8px' }} />
          <Image src={`/networks/${token.network}.svg`} width={24} height={24} alt="" style={{ position: "absolute", top: -8, right: -8 }} />
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
    <StyledCard {...props} className="effect-button" p="8px 16px 8px 8px" onClick={() => router.push(`/${token.network}/${token.tokenAddress}`)}>
      <Box display="flex" flexDirection="column" alignItems="center" gap="8px">
        <TokenLogo logo={token.tokenImage} size="64px" style={{ margin: '4px', borderRadius: '8px' }} />
        <Box display="flex" gap="8px" alignItems="center">
          <Image src={`/networks/${token.network}.svg`} width={16} height={16} alt="" />
          <Box display="flex" px="4px" justifyContent="center" alignItems="flex-end" bgcolor="white" borderRadius="10px">
            <Avatar src={`/pools/${pool?.name}.png`} sx={{ width: 16, height: 16 }} alt="unitswap" />
            <Typography fontSize={10} color="#ff1383" fontWeight="bold">{pool?.version}</Typography>
          </Box>
        </Box>
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
            {!!token.telegramLink && <Link href={token.telegramLink} target="_blank" style={{ opacity: 0.5 }}><Image src={TelegramIcon} width={16} height={16} alt="telegram" /></Link>}
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
          token.launchedAt
            ? <Box display="flex" alignItems="center" mt={1} ml={1}>
              <Image width={20} height={20} alt="mc" src={marketcapIcon} />
              <Typography color="#FBFF00" fontSize={11}>Bonding Complete and Listed on swap</Typography>
            </Box>
            : <Progress value={Number(token.progress ?? 0)} />
        }
      </Box>
    </StyledCard>
  );
}

export default TokenCard;
