"use client";

import {
  Avatar,
  Slide,
  Box,
  Button,
  FormControl,
  styled,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  IconButton,
  InputBase,
  CircularProgress,
  InputLabel,
  Alert,
} from "@mui/material";
import React, { useMemo, useRef } from "react";
import ArrowRightIcon from "@mui/icons-material/KeyboardArrowRightOutlined";
import ArrowDownIcon from "@mui/icons-material/KeyboardArrowDownOutlined";
import DollarIcon from "@mui/icons-material/MonetizationOn";
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { TransitionProps } from "@mui/material/transitions";
import axios from "axios";
import { NumericFormat } from "react-number-format";
import PageBox from "../components/layout/pageBox";
import { API_ENDPOINT } from "@/config";
import { priceFormatter, priceWithoutZero } from "@/utils/price";
import CloseIcon from "@mui/icons-material/Close";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
} from "@reown/appkit/react";
import { useMainContext } from "@/context";
import { ethers } from "ethers";
import toast from "react-hot-toast";
import { useUserInfo } from "@/hooks/user";
import { useHandlers } from "@/hooks/token";
import { playSuccessSound } from "@/utils/sounds";
import Confetti from "react-confetti";
import { useWindowSize } from "@/hooks/useWindowSize";
import { socket } from "@/utils/socket";
// import { useChainInfo, useContractInfo, useSwitchChain } from "../hooks/config";
//import { uploadImageToIPFS } from "../utils";

// Flat citron display headline (§10: no gradient text, no glow).
const Title = styled(Typography)`
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 48px;
  letter-spacing: -0.03em;
  color: var(--citron);
`;

export const BootstrapInput = styled(InputBase)(({ theme }) => ({
  "label + &": {
    marginTop: theme.spacing(3),
  },
  "& .MuiInputBase-input": {
    color: "var(--bone)",
    fontSize: "15px",
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    borderRadius: "12px",
    position: "relative",
    backgroundColor: "rgba(234, 230, 218, 0.04)",
    border: "1px solid rgba(234, 230, 218, 0.08)",
    padding: "14px 18px",
    transition: "border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease",
    "&:focus": {
      borderColor: "var(--citron)",
      backgroundColor: "rgba(234, 230, 218, 0.06)",
      boxShadow: "0 0 0 3px rgba(191, 209, 67, 0.15)",
    },
    "&:hover": {
      borderColor: "rgba(191, 209, 67, 0.4)",
    },
    "&::placeholder": {
      color: "rgba(234, 230, 218, 0.35)",
      fontWeight: 400,
      opacity: 1,
    },
  },
  "& .MuiInputBase-inputMultiline": {
    padding: "0",
  },
}));

// Dashed drag-and-drop zone for the token logo.

const MaxButton = styled(Button)`
  &.MuiButton-root {
    padding: 0 2px;
    font-size: small;
    border: none;
    border-radius: 6px;
    box-shadow: 0px 4px 4px 0px #00000040 inset;
  }
`;

const CurrencyInput = styled(Box)`
  color: var(--bone);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: var(--surface-dark);
  border: 1px solid rgba(234, 230, 218, 0.06);
  padding: 10px 20px;
  gap: 8px;
  & input {
    font-size: 32px;
    font-family: var(--font-data);
    background: transparent;
    color: var(--bone);
    border: none;
    outline: none;
  }
  & button.MuiButton-root {
    padding: 0 2px;
    font-size: x-small;
    border: none;
    border-radius: 6px;
  }
`;

const AvatarWrapper = styled(Box)`
  position: relative;
  display: inline-block;
  cursor: pointer;
  & > label {
    position: absolute;
    right: 5px;
    bottom: 5px;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    cursor: pointer;
    &:hover {
      transform: scale(1.15);
    }
  }
  img {
    object-fit: contain;
  }

  & .MuiAvatar-root {
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    border: 3px solid rgba(234, 230, 218, 0.1);
    box-shadow:
      0 8px 24px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(234, 230, 218, 0.1);
    &:hover {
      border-color: rgba(191, 209, 67, 0.5);
      box-shadow:
        0 8px 24px rgba(0, 0, 0, 0.3),
        inset 0 1px 0 rgba(234, 230, 218, 0.2);
      transform: scale(1.05);
    }
  }

  &.dragover .MuiAvatar-root {
    border-color: rgba(191, 209, 67, 0.7);
    box-shadow:
      0 8px 24px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(234, 230, 218, 0.2);
    transform: scale(1.03);
  }
`;


const Banner = styled("img")`
  border-radius: 48px 48px 0 0;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 300px;
  mask-image: linear-gradient(180deg, #000 30%, #0000 100%);
  object-fit: cover;
`;

const DexSelect = styled(IconButton)<{ label?: string; checked?: boolean }>`
  border-radius: 16px;
  background: ${({ checked }) =>
    checked
      ? "var(--citron)"
      : "rgba(234, 230, 218, 0.04)"
  };
  color: ${({ checked }) => (checked ? "var(--moss-black)" : "var(--bone)")};
  border: 2px solid ${({ checked }) =>
    checked
      ? "rgba(191, 209, 67, 0.5)"
      : "rgba(234, 230, 218, 0.08)"
  };
  display: flex;
  padding: 0;
  gap: 10px;
  flex-wrap: wrap;
  overflow: hidden;
  font-size: 14px;
  font-family: var(--font-body);
  font-weight: ${({ checked }) => (checked ? "700" : "500")};
  letter-spacing: -0.01em;
  padding: 12px 20px;
  transition: all 0.2s ease;
  box-shadow: ${({ checked }) => (checked ? "var(--shadow-sm)" : "none")};

  &:hover {
    background: ${({ checked }) =>
      checked
        ? "var(--accent-light)"
        : "rgba(234, 230, 218, 0.08)"
    };
    color: ${({ checked }) => (checked ? "var(--moss-black)" : "var(--bone)")};
    border-color: ${({ checked }) =>
      checked
        ? "rgba(191, 209, 67, 0.6)"
        : "rgba(191, 209, 67, 0.3)"
    };
  }

  &:active {
    transform: scale(0.98);
  }
`;

const FixWidthDialog = styled(Dialog)<{ width?: any }>`
  & .MuiDialog-paper {
    max-width: ${({ width }) => width ?? "500px"};
  }
`;

const Transition = React.forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement<any, any>;
  },
  ref: React.Ref<unknown>
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export default function Create() {
  // const { open: connect } = useAppKit()
  const [isMounted, setIsMounted] = React.useState(false);
  const { width, height } = useWindowSize();

  const [deployModal, setDeployModal] = React.useState(false);
  const [successModal, setSuccessModal] = React.useState(false);
  const [createdTokenData, setCreatedTokenData] = React.useState<any>(null);
  const [waitingForDeploy, setWaitingForDeploy] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  // Redirect bookkeeping: keep the create button loading until the backend
  // confirms the deployment, then navigate straight to the token page.
  const awaitingDeployRef = React.useRef(false);
  const redirectNetworkRef = React.useRef<string | undefined>(undefined);
  const deployTimeoutRef = React.useRef<any>(null);
  const { address } = useAppKitAccount();

  React.useEffect(() => {
    setIsMounted(true);

    // Listen for deployed event from backend
    const handleDeployed = (data: any) => {
      try {
        const deployedData = typeof data === 'string' ? JSON.parse(data) : data;
        console.log('Token deployed:', deployedData);
        if (!awaitingDeployRef.current || !deployedData?.tokenAddress) return;

        // Confirmed on-chain: stop waiting and go straight to the token page.
        awaitingDeployRef.current = false;
        if (deployTimeoutRef.current) clearTimeout(deployTimeoutRef.current);
        setWaitingForDeploy(false);
        const net = redirectNetworkRef.current || deployedData.network;
        window.location.href = `/token?network=${net}&address=${deployedData.tokenAddress}`;
      } catch (error) {
        console.error('Error parsing deployed event:', error);
      }
    };

    socket.on('deployed', handleDeployed);

    return () => {
      socket.off('deployed', handleDeployed);
    };
  }, []);
  const { caipNetwork: network } = useAppKitNetwork();
  console.log({
    network,
  });

  const { chains, appKit } = useMainContext();
  const { userInfo } = useUserInfo();

  const [coinName, setCoinName] = React.useState("");
  const [coinTicker, setCoinTicker] = React.useState("");
  const [character1, setCharacter1] = React.useState("");
  const [character2, setCharacter2] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [telegramLink, setTelegramLink] = React.useState("");
  const [twitterLink, setTwitterLink] = React.useState("");
  const [webLink, setWebLink] = React.useState("");
  // const [initLiquidityAmount, setInitLiquidityAmount] = React.useState("")
  const [initBuyAmount, setInitBuyAmount] = React.useState<string>("0");
  const [avatar, setAvatar] = React.useState<any>();
  // const [banner, setBanner] = React.useState<any>()
  const [more, setMore] = React.useState(false);
  // const [showParticles, setShowParticles] = React.useState(false)
  const [poolType, setPoolType] = React.useState(1);
  const [isDirectLaunch, setIsDirectLaunch] = React.useState(false);


  const chain = useMemo(
    () =>
      chains?.find(
        (c) =>
          c.chainId === network?.id || c.chainId === network?.chainNamespace
      ),
    [network, chains]
  );

  const handlers = useHandlers(network);

  const tokenAmountOut = useMemo(() => {
    if (chain && initBuyAmount) {
      // Apply 3% platform buy fee to match contract's getAmountOut
      const amountInWithFee = Number(initBuyAmount) * 0.97;
      return (
        (amountInWithFee * Number(chain.virtualTokenAmount)) /
        (Number(chain.virtualEthAmount) + amountInWithFee)
      );
    }
    return 0;
  }, [chain, initBuyAmount]);

  const error = React.useMemo(() => {
    if (!character1) return "You have to name the first character";
    if (!character2) return "You have to name the second character";
    if (!coinName) return "You have to type token name";
    if (!coinTicker) return "You have to type token ticker";
    // if (maxBuyAmount && Number(initBuyAmount) > maxBuyAmount)
    //     return `The initial purchase cannot exceed ${priceFormatter(maxBuyAmount)} ETH`
    return undefined;
  }, [character1, character2, coinName, coinTicker]);

  // const setInitLiquidityPercent = (percent: number) => {
  //     const amount = maxLiquidity * (percent * 100) / 100
  //     setInitLiquidityAmount(priceWithoutZero(amount))
  // }

  const setInitBuyPercent = (percent: number) => {
    const amount = Number(userInfo?.balance ?? 0) * percent;
    setInitBuyAmount(priceWithoutZero(amount));
  };

  const handleClickOpen = () => {
    if (!address) {
      toast.error("Please connect wallet");
      return;
    }

    // if (initLiquidityAmount === "") {
    //     toast.error("Initial Liquidity should be greater than 1M");
    //     return;
    // }

    // if (initLiquidityAmount === "" || Number(initLiquidityAmount) < 1000000) {
    //     toast.error("Initial Liquidity should be greater than 1M");
    //     return;
    // }

    if (character1.trim() === "" || character2.trim() === "") {
      toast.error("Please name both characters to fuse");
      return;
    }

    if (coinName === "") {
      toast.error("Please enter token name");
      return;
    }

    if (coinTicker === "") {
      toast.error("Please enter token ticker");
      return;
    }

    if (![1, 2, 3, 4].includes(poolType)) {
      toast.error("Please select PancakeSwap version to launch");
      return;
    }

    setDeployModal(true);
    // Kick off image generation as soon as the confirm step opens, so the
    // preview is (usually) ready by the time the user reviews their buy amount.
    if (!avatar || !String(avatar).startsWith("http")) {
      generateFusionImage().catch((err: any) => {
        toast.error(err?.response?.data?.error || err?.message || "Image generation failed");
      });
    }
  };

  // Generate the fused character image from the two characters. The backend
  // calls OpenAI, stores the result on our S3, and returns the URL — the browser
  // never touches the OpenAI key. Reused by "Regenerate" in the confirm modal.
  const generateFusionImage = async () => {
    setGenerating(true);
    try {
      const { data } = await axios.post(
        `${API_ENDPOINT}/tokens/generate-image`,
        { character1: character1.trim(), character2: character2.trim(), name: coinName },
        { headers: { "api-key": "hola" } }
      );
      if (!data?.url) throw Error("No image returned");
      setAvatar(data.url);
      return data.url as string;
    } finally {
      setGenerating(false);
    }
  };

  const deployToken = async () => {
    try {
      if (!handlers) {
        console.error("Handlers debug:", {
          network,
          chains,
          hasEvmProvider: !!network,
          networkId: network?.id,
          networkName: network?.name,
          chainNamespace: network?.chainNamespace
        });
        throw Error(`Please connect wallet to a supported network. Current network: ${network?.name || 'unknown'} (${network?.id})`);
      }
      setIsLoading(true);
      // Reuse the already-generated preview if present, else generate now.
      const logoLink = avatar && avatar.startsWith("http") ? avatar : await generateFusionImage();

      const metadata: any = {
        tokenDescription: description,
        tokenName: coinName,
        tokenSymbol: coinTicker,
        tokenImage: logoLink,
        creatorAddress: address,
        network: chain?.network,
        telegramLink,
        twitterLink,
        webLink,
        poolType,
      };

      let mint;
      if (handlers.getMint) {
        mint = handlers.getMint();
        metadata.mintAddress = mint.publicKey.toBase58();
      }

      console.log('[deployToken] metadata:', metadata)
      console.log('[deployToken] initBuyAmount:', initBuyAmount)
      console.log('[deployToken] poolType:', poolType)
      console.log('[deployToken] coinName:', coinName)
      console.log('[deployToken] coinTicker:', coinTicker)
      console.log('[deployToken] chain:', chain)
      console.log('[deployToken] address:', address)

      const {
        data: { success, sig },
      } = await axios.post(`${API_ENDPOINT}/tokens`, metadata);
      console.log('[deployToken] API response:', { success, sig })
      if (!success) throw Error("API error");
      console.log('[deployToken] calling handler with:', {
        name: coinName,
        symbol: coinTicker,
        pool: poolType,
        amount: initBuyAmount,
        sig,
        isDirectLaunch,
      })
      if (isDirectLaunch) {
        await handlers.createTokenDirect(
          {
            name: coinName,
            symbol: coinTicker,
          },
          sig
        );
      } else {
        await handlers.createToken(
          {
            name: coinName,
            symbol: coinTicker,
            pool: poolType,
            amount: initBuyAmount,
            secretKey: mint?.secretKey,
          },
          sig
        );
      }

      // Store created token data (address will be updated via socket event)
      setCreatedTokenData({
        tokenAddress: null, // Will be updated by socket event
        name: coinName,
        symbol: coinTicker,
        description,
        logo: logoLink,
        network: chain?.network,
        initialBuy: initBuyAmount || "0",
        tokensReceived: tokenAmountOut,
      });

      // Tx submitted. Keep the first modal's button in its loading state until
      // the backend confirms the deployment, then redirect to the token page.
      // No intermediate "waiting confirmation" modal.
      redirectNetworkRef.current = chain?.network;
      awaitingDeployRef.current = true;
      setWaitingForDeploy(true);
      playSuccessSound();

      // Safety net: release the button if confirmation never arrives.
      if (deployTimeoutRef.current) clearTimeout(deployTimeoutRef.current);
      deployTimeoutRef.current = setTimeout(() => {
        if (!awaitingDeployRef.current) return;
        awaitingDeployRef.current = false;
        setWaitingForDeploy(false);
        setIsLoading(false);
        toast.error("Still confirming on-chain — check your profile shortly.");
      }, 120000);

      // Leave isLoading = true; the button keeps spinning until the redirect.
      return;
    } catch (ex: any) {
      console.error("Error deploying token:", ex);
      const messageError =
        ex?.shortMessage || ex?.data?.message || ex?.message || "Unknown error";
      toast.error(messageError);
    }
    setIsLoading(false);
  };

  const resetForm = () => {
    // reset state
    setCharacter1("");
    setCharacter2("");
    setCoinName("");
    setCoinTicker("");
    setDescription("");
    setTelegramLink("");
    setTwitterLink("");
    setWebLink("");
    // setInitLiquidityAmount('0');
    setInitBuyAmount("0");
    setAvatar(undefined);
    // setTokenAddressDeployed(undefined)
  };

  const handleClose = () => {
    if (!isLoading) setDeployModal(false);
  };

  // const handleBanner = (e: any) => {
  //     console.log('banner')
  //     const file = e.target.files[0]
  //     const reader = new FileReader()
  //     reader.onloadend = () => {
  //         setBanner(reader.result)
  //     }
  //     reader.readAsDataURL(file)
  // }
  return (
    <PageBox mt={6}>
      <Box
        display="flex"
        alignItems="flex-start"
        justifyContent="center"
        sx={{ position: "relative", zIndex: 1 }}
      >
        {/* Approved create CTA (§15). Matches the nav and header entry points. */}
        <Title
          fontSize={[24, 28, 36]}
          fontFamily="var(--font-display)"
          textTransform="uppercase"
        >
          Make a match
        </Title>
        {/* <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', position: 'absolute', right: 0 }}>
                    <ArrowLeftIcon sx={{ color: 'white', height: 24 }} />
                    <Typography sx={{ color: 'white', textDecoration: 'none' }} fontSize="small">Go back</Typography>
                </Link> */}
      </Box>
      <Box
        marginTop="20px"
        mx="auto"
        width={{ md: "80%", sm: "80%", xs: "100%" }}
        maxWidth="900px"
        display="flex"
        flexDirection="column"
        gap="1.5rem"
        sx={{
          boxSizing: "border-box",
          zIndex: 1,
          background: "rgba(234, 230, 218, 0.02)",
          border: "1px solid rgba(234, 230, 218, 0.06)",
          borderRadius: "20px",
          p: { xs: 2.5, md: 4 },
        }}
      >
        <Box
          display="flex"
          gap="1.5rem"
          flexDirection={{ xs: "column", sm: "column", md: "row" }}
        >
          <FormControl variant="standard" sx={{ flex: 1 }}>
            <InputLabel shrink className="required">
              Character 1 <span style={{ color: "var(--down)" }}>*</span>
            </InputLabel>
            <BootstrapInput
              fullWidth
              placeholder="e.g. Elon Musk"
              value={character1}
              onChange={(e) => setCharacter1(e.target.value)}
            />
          </FormControl>
          <FormControl variant="standard" sx={{ flex: 1 }}>
            <InputLabel shrink className="required">
              Character 2 <span style={{ color: "var(--down)" }}>*</span>
            </InputLabel>
            <BootstrapInput
              fullWidth
              placeholder="e.g. Jeff Bezos"
              value={character2}
              onChange={(e) => setCharacter2(e.target.value)}
            />
          </FormControl>
        </Box>
        {/* Two icons enter, one image leaves — the fused character is generated
            by AI from the two names above when you launch. */}
        <Typography fontSize={12} color="var(--muted)" fontFamily="var(--font-data)" sx={{ mt: -1 }}>
          The fused character image is generated by AI from these two — no upload needed.
        </Typography>
        <Box
          display="flex"
          gap="1.5rem"
          flexDirection={{ xs: "column", sm: "row" }}
        >
          <FormControl variant="standard" sx={{ flex: 1 }}>
            <InputLabel shrink className="required">
              Token name <span style={{ color: "var(--down)" }}>*</span>
            </InputLabel>
            <BootstrapInput
              fullWidth
              placeholder="Token name"
              value={coinName}
              onChange={(e) => setCoinName(e.target.value)}
            />
          </FormControl>
          <FormControl variant="standard" sx={{ flex: 1 }}>
            <InputLabel shrink className="required">
              Token ticker <span style={{ color: "var(--down)" }}>*</span>
            </InputLabel>
            <BootstrapInput
              fullWidth
              placeholder="Token ticker"
              value={coinTicker}
              onChange={(e) => setCoinTicker(e.target.value)}
            />
          </FormControl>
        </Box>
        <FormControl variant="standard">
          <InputLabel shrink>
            Description <span style={{ color: "var(--muted)" }}>(optional)</span>
          </InputLabel>
          <BootstrapInput
            fullWidth
            placeholder="Description"
            multiline
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormControl>
        {!!address && (
          <FormControl variant="standard">
            <InputLabel shrink>
              Choose Target Pool <span style={{ color: "var(--down)" }}>*</span>
            </InputLabel>
            <Box display="flex" alignItems="center" gap="8px" mt={3}>
              {chain?.pools.map((pool: string, index) => (
                <DexSelect
                  key={pool}
                  checked={poolType === index + 1}
                  label="PancakeSwap"
                  onClick={() => {
                    setPoolType(index + 1);
                    setIsDirectLaunch(pool.includes('direct'));
                  }}
                >
                  <Avatar
                    src={`/pools/${pool?.split(":")?.[0]}.png`}
                    sx={{ width: 16, height: 16 }}
                    alt="pancakeswap"
                  />
                  {pool?.split(":")?.[1]}
                </DexSelect>
              ))}
            </Box>
          </FormControl>
        )}
        <Box
        >
          {more ? (
            <ArrowDownIcon sx={{ color: "var(--bone)", height: 24 }} />
          ) : (
            <ArrowRightIcon sx={{ color: "var(--bone)", height: 24 }} />
          )}
          <Typography
            sx={{ color: "var(--bone)", textDecoration: "none" }}
            fontSize="small"
            onClick={() => setMore(!more)}
          >
            More options
          </Typography>
        </Box>
        {more && (
          <>
            <FormControl variant="standard">
              <InputLabel shrink>Telegram Link</InputLabel>
              <BootstrapInput
                fullWidth
                placeholder="Telegram Link"
                value={telegramLink}
                onChange={(e) => setTelegramLink(e.target.value)}
              />
            </FormControl>
            <FormControl variant="standard">
              <InputLabel shrink>Twitter Link</InputLabel>
              <BootstrapInput
                fullWidth
                placeholder="Twitter Link"
                value={twitterLink}
                onChange={(e) => setTwitterLink(e.target.value)}
              />
            </FormControl>
            <FormControl variant="standard">
              <InputLabel shrink>Website Link</InputLabel>
              <BootstrapInput
                fullWidth
                placeholder="Website Link"
                value={webLink}
                onChange={(e) => setWebLink(e.target.value)}
              />
            </FormControl>

            {/* <IconButton sx={{ borderRadius: '16px', textTransform: 'none', background: '#FFFFFF0F', p: '12px 20px', fontSize: 16 }} component="label">
                            Select banner image
                            <HiddenInput ref={fileBannerRef} type="file" onChange={handleBanner} />
                        </IconButton> */}
            {/* <FormControl fullWidth>
                            <InputLabel id="demo-simple-select-label">DEX</InputLabel>
                            <Select
                                labelId="demo-simple-select-label"
                                id="demo-simple-select"
                                value={numberOfRouters}
                                label="Number of routers"

                            >
                                <MenuItem value={"1"}><img style={{ marginBottom: "25px" }} src={NineInchIcon} width={10} height={10} alt="telegramColorIcon" /></MenuItem>
                                <MenuItem
                                    value={""}><img style={{ marginBottom: "25px" }} src={NineMMIcon} width={10} height={10} alt="pulseXicom" />
                                </MenuItem>
                                <MenuItem
                                    value={"3"}><img style={{ marginBottom: "25px" }} src={PulsexIcon} width={10} height={10} alt="pulseXicom" />
                                </MenuItem>

                            </Select>
                        </FormControl> */}
          </>
        )}
        {address ? (
          <Button
            sx={{
              background: "var(--citron)",
              color: "var(--moss-black)",
              padding: "14px 24px",
              borderRadius: "12px",
              fontWeight: 700,
              fontSize: "16px",
              textTransform: "none",
              transition: "all 0.2s ease",
              "&:hover": {
                background: "var(--accent-light)",
              },
              "&:active": {
                transform: "scale(0.98)",
              },
            }}
            fullWidth
            onClick={handleClickOpen}
          >
            Start a fusion on {network?.name}
          </Button>
        ) : (
          <Button
            sx={{
              background: "var(--citron)",
              color: "var(--moss-black)",
              padding: "14px 24px",
              borderRadius: "12px",
              fontWeight: 700,
              fontSize: "16px",
              textTransform: "none",
              transition: "all 0.2s ease",
              "&:hover": {
                background: "var(--accent-light)",
              },
              "&:active": {
                transform: "scale(0.98)",
              },
            }}
            fullWidth
            onClick={() => appKit?.open()}
          >
            Connect Wallet
          </Button>
        )}
      </Box>
      <FixWidthDialog
        disableEscapeKeyDown={isLoading}
        open={deployModal}
        TransitionComponent={Transition}
        keepMounted
        onClose={handleClose}
        aria-describedby="alert-dialog-slide-description"
      >
        <DialogTitle>
          {isDirectLaunch ? "Make a match" : "Buy now"}
          <IconButton aria-label="close" onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {/* Fused character preview — generated from the two characters. */}
          <Box display="flex" flexDirection="column" alignItems="center" mb="1rem" gap={1}>
            <Box
              sx={{
                width: 160,
                height: 160,
                borderRadius: "16px",
                overflow: "hidden",
                border: "1px solid var(--border)",
                background: "var(--surface-dark)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              {avatar && String(avatar).startsWith("http") ? (
                <img src={avatar} alt="fused character" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: generating ? 0.4 : 1 }} />
              ) : (
                <Box className="fyuz-loader"><span className="fyuz-loader__disc fyuz-loader__disc--a" /><span className="fyuz-loader__disc fyuz-loader__disc--b" /></Box>
              )}
              {generating && avatar && String(avatar).startsWith("http") && (
                <CircularProgress size={28} sx={{ position: "absolute", color: "var(--citron)" }} />
              )}
            </Box>
            <Button
              size="small"
              disabled={generating}
              onClick={() => generateFusionImage().catch((err: any) => toast.error(err?.response?.data?.error || err?.message || "Image generation failed"))}
              sx={{ textTransform: "none", color: "var(--muted)", fontSize: 12 }}
            >
              {generating ? "Fusing…" : "↻ Regenerate"}
            </Button>
          </Box>
          <DialogContentText mb="1rem" fontSize={14}>
            {isDirectLaunch
              ? "Create token with 1B supply. No bonding curve."
              : `Choose how many ${network?.nativeCurrency.symbol} you want to buy (optional).`
            }
          </DialogContentText>
          {!isDirectLaunch && (
            <DialogContentText mb="1rem" fontSize={14}>
              Tip: its optional but buying a small amount of coins helps protect
              your coin from snipers
            </DialogContentText>
          )}
          {!isDirectLaunch && (
          <FormControl fullWidth variant="standard">
            <Box display="flex" gap="8px">
              <Typography component="span" color="rgba(234,230,218,0.53)" fontSize={14}>
                Spend
              </Typography>
              <Typography
                component="span"
                color="rgba(234,230,218,0.53)"
                fontFamily="var(--font-data)"
                fontSize={14}
                ml="auto"
              >
                Balance: {priceFormatter(userInfo?.balance ?? 0)}
              </Typography>
              <MaxButton color="secondary" onClick={() => setInitBuyPercent(1)}>
                Max
              </MaxButton>
            </Box>
            <CurrencyInput mt={1}>
              <NumericFormat
                placeholder="0.0"
                thousandSeparator
                valueIsNumericString
                value={initBuyAmount ?? ""}
                onValueChange={(values) => {
                  setInitBuyAmount(values.value);
                }}
              />
              {/* <Box display="flex" gap="8px">
                                <Button variant="outlined" color="secondary" onClick={() => setInitBuyPercent(0.25)}>25%</Button>
                                <Button variant="outlined" color="secondary" onClick={() => setInitBuyPercent(0.5)}>50%</Button>
                                <Button variant="outlined" color="secondary" onClick={() => setInitBuyPercent(0.75)}>75%</Button>
                                <Button variant="outlined" color="secondary" onClick={() => setInitBuyPercent(1)}>MAX</Button>
                            </Box> */}
            </CurrencyInput>
          </FormControl>
          )}
          {!!error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}
          {tokenAmountOut > 0 && (
            <DialogContentText mt="0.2em" fontSize={14} textAlign="center">
              You'll receive: {priceFormatter(tokenAmountOut, 0)} {coinTicker}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            disabled={isLoading || !!error}
            endIcon={
              isLoading ? (
                <CircularProgress size={18} sx={{ color: "var(--moss-black)" }} />
              ) : undefined
            }
            onClick={deployToken}
            fullWidth
            sx={{
              background: isLoading || !!error
                ? "rgba(191, 209, 67, 0.3)"
                : "var(--citron)",
              color: "var(--moss-black)",
              padding: "14px 24px",
              borderRadius: "12px",
              fontWeight: 700,
              fontSize: "16px",
              textTransform: "none",
              transition: "all 0.2s ease",
              "&:hover": {
                background: isLoading || !!error
                  ? "rgba(191, 209, 67, 0.3)"
                  : "var(--accent-light)",
              },
              "&:active": {
                transform: isLoading || !!error ? "none" : "scale(0.98)",
              },
              "&:disabled": {
                // Pure moss-black loading label + spinner for clear contrast on the
                // dimmed button; only the error-disabled state stays muted.
                color: isLoading ? "var(--moss-black)" : "rgba(19, 18, 8, 0.4)",
              },
            }}
          >
            {isLoading
              ? waitingForDeploy
                ? "Confirming on-chain..."
                : "Creating token..."
              : "Book the bout"}
          </Button>
        </DialogActions>
        {
          // platformFee > 0n &&
          // <Typography mt={-1} mb={3} textAlign="center" fontSize={14}>
          //     Cost to deploy: {priceFormatter(Number(ethers.formatEther(platformFee)))} ETH
          // </Typography>
        }
      </FixWidthDialog>

      {/* Success Dialog */}
      <Dialog
        open={successModal}
        TransitionComponent={Transition}
        keepMounted
        onClose={() => setSuccessModal(false)}
        aria-describedby="success-dialog-description"
        maxWidth={false}
        slotProps={{
          paper: {
            sx: {
              width: "620px",
              maxWidth: "90vw",
              minHeight: "auto",
              m: 2,
              overflow: "hidden",
              position: "relative",
              zIndex: 2,
            }
          }
        }}
      >
        {isMounted && successModal && (
          <Box sx={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 0, pointerEvents: "none" }}>
            <Confetti
              width={width}
              height={height}
              recycle={false}
              numberOfPieces={500}
              gravity={0.3}
            />
          </Box>
        )}
        <DialogTitle sx={{ pb: 1.5, pt: 2.5, px: 4 }}>
          <Box display="flex" alignItems="center" gap={1}>
            <CheckCircleOutlineIcon sx={{ fontSize: 22, color: "var(--tangerine)" }} />
            <Typography fontSize={20} fontWeight={600} fontFamily="var(--font-display)" color="var(--tangerine)">Token Created Successfully!</Typography>
          </Box>
          <IconButton
            aria-label="close"
            onClick={() => setSuccessModal(false)}
            sx={{ position: "absolute", right: 12, top: 12 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 4, py: 0, overflow: "hidden" }}>
          {createdTokenData && (
            <Box>
              <Box
                display="flex"
                alignItems="center"
                gap={2.5}
                p={2.5}
                bgcolor="rgba(234, 230, 218, 0.05)"
                borderRadius={2}
                mb={2.5}
              >
                {createdTokenData.logo && (
                  <Avatar
                    src={createdTokenData.logo}
                    sx={{ width: 64, height: 64, flexShrink: 0, borderRadius: 2 }}
                  />
                )}
                <Box sx={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                  <Typography fontSize={20} fontWeight={600} fontFamily="var(--font-display)" noWrap>{createdTokenData.name}</Typography>
                  <Typography fontSize={16} fontFamily="var(--font-data)" color="text.secondary" noWrap>
                    ${createdTokenData.symbol}
                  </Typography>
                </Box>
              </Box>

              <Box mb={2.5}>
                <Typography fontSize={13} color="text.secondary" mb={1}>
                  Token Address:
                </Typography>
                {waitingForDeploy || !createdTokenData.tokenAddress ? (
                  <Box
                    sx={{
                      bgcolor: "rgba(234, 230, 218, 0.05)",
                      p: 2,
                      borderRadius: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                    }}
                  >
                    <CircularProgress size={18} />
                    <Typography fontSize={13} color="text.secondary">
                      Waiting for blockchain confirmation...
                    </Typography>
                  </Box>
                ) : (
                  <Box
                    sx={{
                      bgcolor: "rgba(234, 230, 218, 0.05)",
                      p: 2,
                      borderRadius: 1,
                      maxWidth: "100%",
                      overflow: "hidden",
                    }}
                  >
                    <Typography
                      fontSize={12}
                      sx={{
                        fontFamily: "var(--font-data)",
                        wordBreak: "break-all",
                        lineHeight: 1.6,
                      }}
                    >
                      {createdTokenData.tokenAddress}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 4, pb: 4, pt: 0 }}>
          <Button
            onClick={() => {
              if (createdTokenData?.tokenAddress && createdTokenData?.network) {
                window.location.href = `/token?network=${createdTokenData.network}&address=${createdTokenData.tokenAddress}`;
              }
            }}
            variant="contained"
            fullWidth
            disabled={waitingForDeploy || !createdTokenData?.tokenAddress}
            startIcon={
              waitingForDeploy ? (
                <CircularProgress size={20} sx={{ color: "rgba(19, 18, 8, 0.4)" }} />
              ) : undefined
            }
            sx={{
              // Win state: this button only appears after a successful fusion,
              // so it earns tangerine rather than the everyday citron accent.
              background: waitingForDeploy || !createdTokenData?.tokenAddress
                ? "rgba(232, 106, 43, 0.3)"
                : "var(--tangerine)",
              color: "var(--moss-black)",
              py: 2.5,
              fontSize: 18,
              fontWeight: 700,
              textTransform: "none",
              borderRadius: "12px",
              transition: "all 0.2s ease",
              "&:hover": {
                background: waitingForDeploy || !createdTokenData?.tokenAddress
                  ? "rgba(232, 106, 43, 0.3)"
                  : "#F08A52",
              },
              "&:active": {
                transform: waitingForDeploy || !createdTokenData?.tokenAddress
                  ? "none"
                  : "scale(0.98)",
              },
              "&:disabled": {
                color: "rgba(19, 18, 8, 0.4)",
              },
            }}
          >
            {waitingForDeploy ? "Waiting for confirmation..." : "View Token"}
          </Button>
        </DialogActions>
      </Dialog>
    </PageBox>
  );
}
