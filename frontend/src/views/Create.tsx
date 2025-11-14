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
// import { useChainInfo, useContractInfo, useSwitchChain } from "../hooks/config";
//import { uploadImageToIPFS } from "../utils";

const Title = styled(Typography)`
  background: linear-gradient(
    90deg,
    #ff8e08 0.14%,
    #fdffb3 11.87%,
    #ffed4c 23.15%,
    #fbe4a8 54.37%,
    #f8d185 74.22%,
    #e66606 79.32%,
    #fcf3a0 86.96%,
    #ff7629 100%
  );
  background-clip: text;
  text-fill-color: transparent;
`;

export const BootstrapInput = styled(InputBase)(({ theme }) => ({
  "label + &": {
    marginTop: theme.spacing(3),
  },
  "& .MuiInputBase-input": {
    color: "black",
    fontSize: "18px",
    borderRadius: "4px",
    position: "relative",
    backgroundColor: "#FFF",
    border: "none",
    padding: "8px 20px",
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
  }
  img {
    object-fit: contain;
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
  border-radius: 4px;
  background: ${({ checked }) => (checked ? "#FFF" : "#FFF2")};
  color: ${({ checked }) => (checked ? "black" : "#FFF")};
  display: flex;
  padding: 0;
  gap: 10px;
  flex-wrap: wrap;
  overflow: hidden;
  font-size: 12px;
  padding: 8px;
  &:hover {
    background: ${({ checked }) => (checked ? "#FFF" : "#FFF2")};
    color: ${({ checked }) => (checked ? "black" : "#FFF")};
    opacity: 0.7;
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

  const [deployModal, setDeployModal] = React.useState(false);
  // const [tokenAddressDeployed, setTokenAddressDeployed] = React.useState<string>();
  const { address } = useAppKitAccount();
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
    const r = axios.post(`${API_ENDPOINT}/tokens/upload`, formData, {
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
      const logoLink = logoUploadResult.data.file.filename;

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
      setDeployModal(false);
      resetForm();
      toast.success("Submitted successfully");
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
              background: "white",
              color: "black",
              padding: "12px",
              borderRadius: "16px",
            }}
            className="effect-button"
            fullWidth
            onClick={handleClickOpen}
          >
            Deploy on {network?.name}
          </Button>
        ) : (
          <Button
            sx={{
              background: "white",
              color: "black",
              padding: "12px",
              borderRadius: "16px",
            }}
            className="effect-button"
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
                <CircularProgress color="inherit" size={14} />
              ) : undefined
            }
            onClick={deployToken}
            fullWidth
          >
            {isLoading ? "Creating token" : "Create token"}
          </Button>
        </DialogActions>
        {
          // platformFee > 0n &&
          // <Typography mt={-1} mb={3} textAlign="center" fontSize={14}>
          //     Cost to deploy: {priceFormatter(Number(ethers.formatEther(platformFee)))} ETH
          // </Typography>
        }
      </FixWidthDialog>
      {/* {
                !!tokenAddressDeployed &&
                <SuccessScreen>
                    <Confetti shapeSize={20} mode="fall" particleCount={100} colors={['#ff577f', '#ff884b', '#2C945D', '#205998']} />
                </SuccessScreen>
            } */}
    </PageBox>
  );
}
