'use client'

import { InfoList } from "@/components/InfoList";
import { useMainContext } from "@/context";
import { Box, IconButton, InputAdornment, Pagination, PaginationItem, Stack, styled, TextField, Typography, useMediaQuery } from "@mui/material";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import ArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CheckIcon from '@mui/icons-material/Check';
import { useTokens } from "@/hooks/token";
import PageBox from "@/components/layout/pageBox";
import Link from "next/link";
import ComboBox from "@/components/ComboBox";
import TokenCard from "@/components/cards/token";

const CreateButton = styled(Link)`
    border-radius: 8px;
    border: 1px solid #999;
    box-shadow: 0px 6px 8px 2px #9996 inset, 0px -4px 8px 0px #9991 inset, 0 0 10px #0008;
    color: white;
    font-family: Arial;
    font-weight: 400;
    font-size: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 20px;
    cursor: pointer;
    text-decoration: none;
    & > span {
        &:nth-of-type(8n) {
            animation: opacity-animation2 1.6s infinite linear;
            animation-delay: 0;
        }
        &:nth-of-type(8n+1) {
            animation: opacity-animation2 1.6s infinite linear;
            animation-delay: 0.2s;
        }
        &:nth-of-type(8n+2) {
            animation: opacity-animation2 1.6s infinite linear;
            animation-delay: 0.4s;
        }
        &:nth-of-type(8n+3) {
            animation: opacity-animation2 1.6s infinite linear;
            animation-delay: 0.6s;
        }
        &:nth-of-type(8n+4) {
            animation: opacity-animation2 1.6s infinite linear;
            animation-delay: 0.8n;
        }
        &:nth-of-type(8n+5) {
            animation: opacity-animation2 1.6s infinite linear;
            animation-delay: 1s;
        }
        &:nth-of-type(8n+6) {
            animation: opacity-animation2 1.6s infinite linear;
            animation-delay: 1.2s;
        }
        &:nth-of-type(8n+7) {
            animation: opacity-animation2 1.6s infinite linear;
            animation-delay: 1.4s;
        }
    }
    &:hover {
        border-color: #AAA;
        box-shadow: 0px 4px 4px 2px rgba(6, 182, 212, 0.2) inset, 0px -4px 8px 0px rgba(6, 182, 212, 0.1) inset, 0 0 10px #0008;
    }
    ${({ theme }) => theme.breakpoints.down(800)} {
        font-size: 24px;
    }
`

const SearchToken = styled(TextField)`
    align-self: stretch;
    flex: 1;
    & .MuiOutlinedInput-root {
        border-radius: 8px;
        border: 1px solid #9993;
        // box-shadow: 0px 6px 8px 2px #9996 inset, 0px -4px 8px 0px #9991 inset, 0 0 10px #0008;
        font-size: 1em;
        backdrop-filter: blur(10px);

        &:hover {
            border-color: #AAA;
            box-shadow: 0px 4px 4px 2px rgba(6, 182, 212, 0.2) inset, 0px -4px 8px 0px rgba(6, 182, 212, 0.1) inset, 0 0 10px #0008;
        }

        & fieldset {
            border-color: transparent !important;
        }
    }
`;

const SearchButton = styled('button')`
    background: transparent;
    border-radius: 8px;
    border: 1px solid #999;
    box-shadow: 0px 6px 8px 2px #9996 inset, 0px -4px 8px 0px #9991 inset;
    color: white;
    font-family: Arial;
    font-weight: 400;
    font-size: 32px;
    display: flex;
    align-items: center;
    padding: 13px;
    cursor: pointer;
    text-decoration: none;
    backdrop-filter: blur(10px);
    &:hover {
        border-color: #AAA;
        box-shadow: 0px 4px 4px 2px rgba(6, 182, 212, 0.2) inset, 0px -4px 8px 0px rgba(6, 182, 212, 0.1) inset;
    }
`

const CardGrid = styled(Box) <{ min: number, space: number }>`
    display: grid;
    width: 100%;
    align-items: stretch;
    // grid-auto-flow: row dense;
    grid-template-columns: repeat(auto-fill, minmax(${({ min }) => min}px, 1fr));
    gap: 16px ${({ space }) => space}px;

    ${({ theme }) => theme.breakpoints.down(400)} {
        grid-template-columns: 1fr;
    }
`;

export default function Home() {
    const [network, setNetwork] = useState('all');
    const [orderType, setOrderType] = useState('marketcap');
    const [orderFlag] = useState('DESC');
    const [searchWord, setSearchWord] = useState('');
    const [pageNumber, setPageNumber] = useState(1);
    const [pageTrendsNumber, setPageTrendsNumber] = useState(1);
    const [inSearch, setInSearch] = useState(false);
    const [width, setWidth] = useState(0);
    const elementRef = useRef<HTMLElement>(undefined);

    const { chains } = useMainContext()
    const isMobile = useMediaQuery('(max-width: 800px)')

    const searchTokenInputProps = useMemo(() => ({
        startAdornment: (
            <InputAdornment position="start">
                {
                    inSearch
                        ? <ArrowBackIcon onClick={() => setInSearch(false)} />
                        : <SearchIcon sx={{ width: { md: 36, sm: 24, xs: 24 }, height: { md: 36, sm: 24, xs: 24 } }} />
                }
            </InputAdornment>
        ),
        endAdornment: (
            <InputAdornment style={{ cursor: "pointer", visibility: searchWord.length > 0 ? 'visible' : 'hidden' }} position="end" onClick={() => {
                setSearchWord('')
            }}>
                <CloseIcon sx={{ height: 18 }} />
            </InputAdornment>
        )
    }), [searchWord, inSearch])

    const pageSize = useMemo(() => {
        const cols = Math.floor((width + 32) / 382)
        if (cols === 0)
            return 5
        if (cols < 3)
            return cols * 5
        if (cols < 5)
            return cols * 4
        return cols * 3
    }, [width])

    const pageTrendSize = useMemo(() => {
        return Math.floor((width + 12) / 192)
    }, [width])

    const { tokens, count } = useTokens({
        network, searchWord, orderType, orderFlag, pageNumber, pageSize
    })

    const { tokens: trends } = useTokens({
        pageNumber: pageTrendsNumber, pageSize: pageTrendSize
    })

    const totalPage = useMemo(() => {
        return Math.floor(count / pageSize) + (count % pageSize === 0 ? 0 : 1)
    }, [count, pageSize])

    useLayoutEffect(() => {
        const updateWidth = () => {
            if (elementRef.current) {
                setWidth(elementRef.current.offsetWidth);
            }
        };
        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => {
            window.removeEventListener('resize', updateWidth);
        };
    }, [])

    const handleChange = (event: any, value: any) => {
        setPageNumber(value);
        // This logs the current page number to the console
    };

    return (
        <PageBox mt={isMobile ? 0 : "-92px"}>
            <Box
                position="sticky"
                top={isMobile ? '80px' : 14}
                pl={isMobile ? 0 : '430px'}
                display="flex"
                gap={{ xs: "8px", sm: "8px", md: "16px" }}
                alignItems="stretch"
                mb={1}
                zIndex={2}
            >
                {
                    !inSearch &&
                    <CreateButton href="/forge" className="effect-button" style={isMobile ? { flex: 1 } : {}}>
                        Create a token!
                    </CreateButton>
                }
                {
                    (!isMobile || inSearch) &&
                    <SearchToken
                        placeholder="Search for token"
                        value={searchWord}
                        fullWidth={inSearch}
                        onChange={(e) => setSearchWord(e.target.value)}
                        InputProps={searchTokenInputProps}
                    />
                }
                {
                    isMobile && !inSearch &&
                    <SearchButton onClick={() => setInSearch(true)}>
                        <SearchIcon />
                    </SearchButton>
                }
            </Box>
            <Box display="flex" gap="8px" p="4px 16px" mx={{ xs: 0, sm: "-8px", md: "-15px"}} my={2} alignItems="center" bgcolor="black">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3.375 15L1.5 6.375L5.25 8.25L9 3L12.75 8.25L16.5 6.375L14.625 15H3.375Z" fill="#D6DEC7" stroke="#D6DEC7" strokeWidth="1.66667" strokeLinejoin="round" />
                    <path d="M8.99902 8.25C10.4073 8.25 11.5487 9.39159 11.5488 10.7998C11.5488 12.2081 10.4073 13.3496 8.99902 13.3496C7.5908 13.3495 6.44922 12.208 6.44922 10.7998C6.44932 9.39165 7.59087 8.25011 8.99902 8.25Z" fill="#6CFF32" stroke="black" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <Typography fontSize={12} fontWeight="bold" color="#D6DEC7">New trending tokens</Typography>
                <IconButton sx={{ ml: "auto" }} onClick={() => pageTrendsNumber > 1 && setPageTrendsNumber(pageTrendsNumber - 1)}>
                    <ArrowBackIcon sx={{ width: 12, height: 12 }} />
                </IconButton>
                <IconButton onClick={() => pageTrendsNumber < 5 && setPageTrendsNumber(pageTrendsNumber + 1)}>
                    <ArrowForwardIcon sx={{ width: 12, height: 12 }} />
                </IconButton>
            </Box>
            <CardGrid min={180} space={12} ref={elementRef}>
                {
                    trends.slice(0, pageTrendSize).map((item: any) => (
                        <TokenCard key={`trend-token-${item.tokenAddress}`} token={item} mode="trends" />
                    ))
                }
            </CardGrid>
            <Box display="flex" flexDirection={{ xs: 'column', sm: 'row' }} gap="8px" my={2} alignItems="center">
                <ComboBox label="Sort" values={{
                    bump: 'Trending',
                    marketcap: 'Market cap',
                    creationTime: 'Creation time',
                    volume: 'Trading volume',
                    // progress: 'Progress' 
                }} value={orderType} onChange={setOrderType} />
                <ComboBox label="Network" values={{
                    all: 'All',
                    ...(
                        chains?.reduce((networks, c) => ({
                            ...networks, [c.network]: c.name
                        }), {})
                    )
                }} value={network} onChange={setNetwork} />
            </Box>
            {
                tokens.length > 0 ?
                    <CardGrid min={350} space={32} mb={4}>
                        {
                            tokens.map((item: any) => (
                                <TokenCard key={item.tokenAddress} token={item} mode="list" />
                            ))
                        }
                    </CardGrid> :
                    <Typography textAlign='center' color="#aaa" my={4}>No token found</Typography>
            }
            {
                totalPage > 1 &&
                <Box sx={{ display: 'flex' }} mb={5}>
                    <Stack spacing={2} mx='auto'>
                        <Pagination
                            variant="text"
                            shape="circular"
                            count={totalPage}
                            page={pageNumber}  // current page
                            onChange={handleChange}  // handle page change
                            renderItem={(data) => (
                                <PaginationItem
                                    slots={{ previous: ArrowBackIcon, next: ArrowForwardIcon }}
                                    {...data}
                                />
                            )}
                        />
                    </Stack>
                </Box>
            }
        </PageBox>
    );
}