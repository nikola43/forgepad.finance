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
import EditIcon from "@mui/icons-material/BorderColorOutlined";
import ArrowRightIcon from "@mui/icons-material/KeyboardArrowRightOutlined";
import ArrowDownIcon from "@mui/icons-material/KeyboardArrowDownOutlined";
import DollarIcon from "@mui/icons-material/MonetizationOn";
// import CloudUploadIcon from '@mui/icons-material/CloudUpload';
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
import Confetti from "react-confetti";
import { useWindowSize } from "@/hooks/useWindowSize";
import { socket } from "@/utils/socket";
// import { useChainInfo, useContractInfo, useSwitchChain } from "../hooks/config";
//import { uploadImageToIPFS } from "../utils";

const Title = styled(Typography)`
  font-family: 'Space Grotesk', 'Inter', sans-serif;
  font-weight: 800;
  font-size: 48px;
  letter-spacing: -0.03em;
  background: linear-gradient(
    135deg,
    #FFD700 0%,
    #FFA600 25%,
    #FFE55C 50%,
    #FFA600 75%,
    #FFD700 100%
  );
  background-size: 200% 200%;
  animation: gradientShift 4s ease infinite;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-fill-color: transparent;
  text-shadow: 0 0 80px rgba(255, 166, 0, 0.3);

  @keyframes gradientShift {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
`;

export const BootstrapInput = styled(InputBase)(({ theme }) => ({
  "label + &": {
    marginTop: theme.spacing(3),
  },
  "& .MuiInputBase-input": {
    color: "#0a0a0f",
    fontSize: "16px",
    fontWeight: 500,
    fontFamily: "'Inter', sans-serif",
    borderRadius: "16px",
    position: "relative",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    border: "2px solid rgba(255, 255, 255, 0.1)",
    padding: "14px 20px",
    transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05), inset 0 1px 2px rgba(255, 255, 255, 0.5)",
    "&:focus": {
      borderColor: "#FFA600",
      backgroundColor: "#FFF",
      boxShadow: "0 8px 24px rgba(255, 166, 0, 0.15), 0 0 0 4px rgba(255, 166, 0, 0.1), inset 0 1px 2px rgba(255, 255, 255, 0.8)",
      transform: "translateY(-1px)",
    },
    "&:hover": {
      borderColor: "rgba(255, 166, 0, 0.4)",
      backgroundColor: "#FFF",
      boxShadow: "0 6px 16px rgba(0, 0, 0, 0.08), inset 0 1px 2px rgba(255, 255, 255, 0.6)",
    },
    "&::placeholder": {
      color: "rgba(10, 10, 15, 0.5)",
      fontWeight: 400,
    },
  },
  "& .MuiInputBase-inputMultiline": {
    padding: "14px 20px",
  },
}));

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
  color: black;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  background: white;
  padding: 10px 20px;
  gap: 8px;
  & input {
    font-size: 32px;
    background: transparent;
    color: black;
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
    border: 3px solid rgba(255, 255, 255, 0.1);
    box-shadow:
      0 8px 24px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
    &:hover {
      border-color: rgba(255, 166, 0, 0.5);
      box-shadow:
        0 12px 32px rgba(255, 166, 0, 0.3),
        0 0 40px rgba(255, 166, 0, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.2);
      transform: scale(1.05);
    }
  }
`;

const HiddenInput = styled("input")`
  clip: rect(0 0 0 0);
  clippath: inset(50%);
  height: 100%;
  overflow: hidden;
  position: absolute;
  bottom: 0;
  left: 0;
  white-space: nowrap;
  width: 100%;
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
      ? "linear-gradient(135deg, #FFA600 0%, #FFD700 100%)"
      : "rgba(255, 255, 255, 0.04)"
  };
  backdrop-filter: blur(20px);
  color: ${({ checked }) => (checked ? "#0a0a0f" : "#FFF")};
  border: 2px solid ${({ checked }) =>
    checked
      ? "rgba(255, 166, 0, 0.5)"
      : "rgba(255, 255, 255, 0.08)"
  };
  display: flex;
  padding: 0;
  gap: 10px;
  flex-wrap: wrap;
  overflow: hidden;
  font-size: 14px;
  font-family: 'Space Grotesk', 'Inter', sans-serif;
  font-weight: ${({ checked }) => (checked ? "700" : "500")};
  letter-spacing: -0.01em;
  padding: 12px 20px;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: ${({ checked }) =>
    checked
      ? "0 8px 24px rgba(255, 166, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)"
      : "0 4px 12px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.03)"
  };

  &:hover {
    background: ${({ checked }) =>
      checked
        ? "linear-gradient(135deg, #FFB733 0%, #FFE55C 100%)"
        : "rgba(255, 255, 255, 0.08)"
    };
    color: ${({ checked }) => (checked ? "#0a0a0f" : "#FFF")};
    transform: translateY(-3px) scale(1.02);
    box-shadow: ${({ checked }) =>
      checked
        ? "0 12px 32px rgba(255, 166, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.3)"
        : "0 8px 20px rgba(255, 255, 255, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.06)"
    };
    border-color: ${({ checked }) =>
      checked
        ? "rgba(255, 166, 0, 0.6)"
        : "rgba(255, 166, 0, 0.3)"
    };
  }

  &:active {
    transform: translateY(-1px) scale(1.01);
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
  const { address } = useAppKitAccount();

  React.useEffect(() => {
    setIsMounted(true);

    // Listen for deployed event from backend
    const handleDeployed = (data: string) => {
      try {
        const deployedData = JSON.parse(data);
        console.log('Token deployed:', deployedData);

        // Update created token data with the actual token address
        setCreatedTokenData((prev: any) => {
          if (prev && deployedData.tokenAddress) {
            return {
              ...prev,
              tokenAddress: deployedData.tokenAddress,
            };
          }
          return prev;
        });
        setWaitingForDeploy(false);
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
  const [description, setDescription] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [telegramLink, setTelegramLink] = React.useState("");
  const [twitterLink, setTwitterLink] = React.useState("");
  const [webLink, setWebLink] = React.useState("");
  // const [initLiquidityAmount, setInitLiquidityAmount] = React.useState("")
  const [initBuyAmount, setInitBuyAmount] = React.useState<string>();
  const [avatar, setAvatar] = React.useState<any>();
  // const [banner, setBanner] = React.useState<any>()
  const [more, setMore] = React.useState(false);
  // const [showParticles, setShowParticles] = React.useState(false)
  const [poolType, setPoolType] = React.useState(1);

  const fileBannerRef = useRef<HTMLInputElement>(null);
  const fileLogoRef = useRef<HTMLInputElement>(null);

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
      return (
        (Number(initBuyAmount) * Number(chain.virtualTokenAmount)) /
        (Number(chain.virtualEthAmount) + Number(initBuyAmount))
      );
    }
    return 0;
  }, [chain, initBuyAmount]);

  const error = React.useMemo(() => {
    if (!coinName) return "You have to type token name";
    if (!coinTicker) return "You have to type token ticker";
    // if (maxBuyAmount && Number(initBuyAmount) > maxBuyAmount)
    //     return `The initial purchase cannot exceed ${priceFormatter(maxBuyAmount)} ETH`
    return undefined;
  }, [coinName, coinTicker]);

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

    if (coinName === "") {
      toast.error("Please enter token name");
      return;
    }

    if (coinTicker === "") {
      toast.error("Please enter token ticker");
      return;
    }

    if (description === "") {
      toast.error("Please enter description");
      return;
    }

    if (!avatar) {
      toast.error("Please upload token logo");
      return;
    }

    if (![1, 2, 3].includes(poolType)) {
      toast.error("Please select Uniswap version to launch");
      return;
    }

    setDeployModal(true);
  };

  const uploadLogo = async (img: any) => {
    let formData = new FormData(); // instantiate it
    formData.set("image", img);
    const r = await axios.post(`${API_ENDPOINT}/tokens/upload`, formData, {
      headers: {
        "api-key": "hola",
        "content-type": "multipart/form-data", // do not forget this
      },
    });
    return r;
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
      if (!fileLogoRef.current?.files) throw Error("Choose token logo");
      const logoUploadResult = await uploadLogo(fileLogoRef.current.files[0]);
      const logoLink = logoUploadResult.data.url;

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

      const {
        data: { success, sig },
      } = await axios.post(`${API_ENDPOINT}/tokens`, metadata);
      if (!success) throw Error("API error");
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

      setWaitingForDeploy(true);
      setDeployModal(false);
      setSuccessModal(true);
      resetForm();
      toast.success("Token created successfully!");
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
    setCoinName("");
    setCoinTicker("");
    setDescription("");
    setTelegramLink("");
    setTwitterLink("");
    setWebLink("");
    // setInitLiquidityAmount('0');
    setInitBuyAmount("0");
    setAvatar(undefined);
    if (fileLogoRef.current?.files?.length) fileLogoRef.current.value = "";
    if (fileBannerRef.current?.files?.length) fileBannerRef.current.value = "";
    // setTokenAddressDeployed(undefined)
  };

  const handleClose = () => {
    if (!isLoading) setDeployModal(false);
  };

  const handleAvatar = (e: any) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatar(reader.result);
    };
    reader.readAsDataURL(file);
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
  /* LAUNCH YOUR TOKEN */

  return (
    <PageBox mt={6}>
      <Box
        display="flex"
        alignItems="flex-start"
        justifyContent="center"
        sx={{ position: "relative", zIndex: 1 }}
      >
        <Title
          fontSize={[24, 28, 36]}
          fontFamily="Londrina Solid"
          color="white"
          textTransform="uppercase"
        >
          Launch your token
        </Title>
        {/* <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', position: 'absolute', right: 0 }}>
                    <ArrowLeftIcon sx={{ color: 'white', height: 24 }} />
                    <Typography sx={{ color: 'white', textDecoration: 'none' }} fontSize="small">Go back</Typography>
                </Link> */}
      </Box>
      <Box
        marginTop="20px"
        py={3}
        mx="auto"
        width={{ md: "80%", sm: "80%", xs: "100%" }}
        display="flex"
        flexDirection="column"
        gap="1.5rem"
        sx={{ boxSizing: "border-box", zIndex: 1 }}
      >
        <Box
          display="flex"
          gap="1.5rem"
          flexDirection={{ xs: "column", sm: "column", md: "row" }}
        >
          <div>
            <InputLabel shrink className="required">
              Token logo <span style={{ color: "red" }}>*</span>
            </InputLabel>
            <AvatarWrapper sx={{ width: { xs: "100%", sm: "100%", md: 250 } }}>
              <Avatar
                sx={{
                  width: { xs: "100%", sm: "100%", md: 250 },
                  height: 135,
                  borderRadius: "4px",
                  background: "white",
                  objectFit: "contain",
                }}
                src={avatar}
              >
                <DollarIcon sx={{ color: "black", width: 48, height: 48 }} />
              </Avatar>
              <IconButton
                sx={{ bgcolor: "black", "&:hover": { bgcolor: "#555" } }}
                component="label"
              >
                <EditIcon sx={{ width: 16, height: 16 }} />
                <HiddenInput
                  ref={fileLogoRef}
                  type="file"
                  onChange={handleAvatar}
                />
              </IconButton>
            </AvatarWrapper>
          </div>
          <Box display="flex" flex="1" flexDirection="column" gap="1.5rem">
            <FormControl variant="standard">
              <InputLabel shrink className="required">
                Token name <span style={{ color: "red" }}>*</span>
              </InputLabel>
              <BootstrapInput
                fullWidth
                placeholder="Token name"
                value={coinName}
                onChange={(e) => setCoinName(e.target.value)}
              />
            </FormControl>
            <FormControl variant="standard">
              <InputLabel shrink className="required">
                Token ticker <span style={{ color: "red" }}>*</span>
              </InputLabel>
              <BootstrapInput
                fullWidth
                placeholder="Token ticker"
                value={coinTicker}
                onChange={(e) => setCoinTicker(e.target.value)}
              />
            </FormControl>
          </Box>
        </Box>
        <FormControl variant="standard">
          <InputLabel shrink className="required">
            Description <span style={{ color: "red" }}>*</span>
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
              Choose Target Pool <span style={{ color: "red" }}>*</span>
            </InputLabel>
            <Box display="flex" alignItems="center" gap="8px" mt={3}>
              {chain?.pools.map((pool: string, index) => (
                <DexSelect
                  key={pool}
                  checked={poolType === index + 1}
                  label="Uniswap"
                  onClick={() => setPoolType(index + 1)}
                >
                  <Avatar
                    src={`/pools/${pool?.split(":")?.[0]}.png`}
                    sx={{ width: 16, height: 16 }}
                    alt="unitswap"
                  />
                  {pool?.split(":")?.[1]}
                </DexSelect>
              ))}
            </Box>
          </FormControl>
        )}
        <Box
          display="flex"
          alignItems="center"
          alignSelf="flex-end"
          sx={{ cursor: "pointer" }}
        >
          {more ? (
            <ArrowDownIcon sx={{ color: "white", height: 24 }} />
          ) : (
            <ArrowRightIcon sx={{ color: "white", height: 24 }} />
          )}
          <Typography
            sx={{ color: "white", textDecoration: "none" }}
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
              background: "linear-gradient(135deg, #FFA600 0%, #FFD700 100%)",
              color: "black",
              padding: "14px 24px",
              borderRadius: "12px",
              fontWeight: 700,
              fontSize: "16px",
              textTransform: "none",
              boxShadow: "0 4px 12px rgba(255, 166, 0, 0.3)",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              "&:hover": {
                background: "linear-gradient(135deg, #FFB733 0%, #FFE55C 100%)",
                transform: "translateY(-2px)",
                boxShadow: "0 8px 20px rgba(255, 166, 0, 0.4)",
              },
              "&:active": {
                transform: "translateY(0px)",
              },
            }}
            fullWidth
            onClick={handleClickOpen}
          >
            Deploy on {network?.name}
          </Button>
        ) : (
          <Button
            sx={{
              background: "linear-gradient(135deg, #FFA600 0%, #FFD700 100%)",
              color: "black",
              padding: "14px 24px",
              borderRadius: "12px",
              fontWeight: 700,
              fontSize: "16px",
              textTransform: "none",
              boxShadow: "0 4px 12px rgba(255, 166, 0, 0.3)",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              "&:hover": {
                background: "linear-gradient(135deg, #FFB733 0%, #FFE55C 100%)",
                transform: "translateY(-2px)",
                boxShadow: "0 8px 20px rgba(255, 166, 0, 0.4)",
              },
              "&:active": {
                transform: "translateY(0px)",
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
          {"Buy now"}
          <IconButton aria-label="close" onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <DialogContentText mb="1rem" fontSize={14}>
            Choose how many {network?.nativeCurrency.symbol} you want to buy
            (optional).
          </DialogContentText>
          <DialogContentText mb="1rem" fontSize={14}>
            Tip: its optional but buying a small amount of coins helps protect
            your coin from snipers
          </DialogContentText>
          <FormControl fullWidth variant="standard">
            <Box display="flex" gap="8px">
              <Typography component="span" color="#FFF8" fontSize={14}>
                Spend
              </Typography>
              <Typography
                component="span"
                color="#FFF8"
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
                color="black"
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
                <CircularProgress color="inherit" size={18} />
              ) : undefined
            }
            onClick={deployToken}
            fullWidth
            sx={{
              background: isLoading || !!error
                ? "rgba(255, 166, 0, 0.3)"
                : "linear-gradient(135deg, #FFA600 0%, #FFD700 100%)",
              color: "black",
              padding: "14px 24px",
              borderRadius: "12px",
              fontWeight: 700,
              fontSize: "16px",
              textTransform: "none",
              boxShadow: isLoading || !!error
                ? "none"
                : "0 4px 12px rgba(255, 166, 0, 0.3)",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              "&:hover": {
                background: isLoading || !!error
                  ? "rgba(255, 166, 0, 0.3)"
                  : "linear-gradient(135deg, #FFB733 0%, #FFE55C 100%)",
                transform: isLoading || !!error ? "none" : "translateY(-2px)",
                boxShadow: isLoading || !!error
                  ? "none"
                  : "0 8px 20px rgba(255, 166, 0, 0.4)",
              },
              "&:active": {
                transform: isLoading || !!error ? "none" : "translateY(0px)",
              },
              "&:disabled": {
                color: "rgba(0, 0, 0, 0.4)",
              },
            }}
          >
            {isLoading ? "Creating token..." : "Create token"}
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
            <Typography fontSize={20} component="span" sx={{ color: "#FFD700" }}>
              ✓
            </Typography>
            <Typography fontSize={20} fontWeight={600}>Token Created Successfully!</Typography>
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
                bgcolor="rgba(255, 255, 255, 0.05)"
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
                  <Typography fontSize={20} fontWeight={600} noWrap>{createdTokenData.name}</Typography>
                  <Typography fontSize={16} color="text.secondary" noWrap>
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
                      bgcolor: "rgba(255, 255, 255, 0.05)",
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
                      bgcolor: "rgba(255, 255, 255, 0.05)",
                      p: 2,
                      borderRadius: 1,
                      maxWidth: "100%",
                      overflow: "hidden",
                    }}
                  >
                    <Typography
                      fontSize={12}
                      sx={{
                        fontFamily: "monospace",
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
                <CircularProgress size={20} sx={{ color: "rgba(0, 0, 0, 0.4)" }} />
              ) : undefined
            }
            sx={{
              background: waitingForDeploy || !createdTokenData?.tokenAddress
                ? "rgba(255, 166, 0, 0.3)"
                : "linear-gradient(135deg, #FFA600 0%, #FFD700 100%)",
              color: "black",
              py: 2.5,
              fontSize: 18,
              fontWeight: 700,
              textTransform: "none",
              borderRadius: "12px",
              boxShadow: waitingForDeploy || !createdTokenData?.tokenAddress
                ? "none"
                : "0 4px 12px rgba(255, 166, 0, 0.3)",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              "&:hover": {
                background: waitingForDeploy || !createdTokenData?.tokenAddress
                  ? "rgba(255, 166, 0, 0.3)"
                  : "linear-gradient(135deg, #FFB733 0%, #FFE55C 100%)",
                transform: waitingForDeploy || !createdTokenData?.tokenAddress
                  ? "none"
                  : "translateY(-2px)",
                boxShadow: waitingForDeploy || !createdTokenData?.tokenAddress
                  ? "none"
                  : "0 8px 20px rgba(255, 166, 0, 0.4)",
              },
              "&:active": {
                transform: waitingForDeploy || !createdTokenData?.tokenAddress
                  ? "none"
                  : "translateY(0px)",
              },
              "&:disabled": {
                color: "rgba(0, 0, 0, 0.4)",
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
