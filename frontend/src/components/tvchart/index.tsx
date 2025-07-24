import { useEffect, useRef } from 'react';
import {
    widget,
    ChartingLibraryWidgetOptions,
    LanguageCode,
    ResolutionString,
} from './charting_library';
import * as React from 'react';
import { Box, styled, useMediaQuery } from '@mui/material';

// import Logo from '@/assets/images/logo.png';
import axios from 'axios';
import { API_ENDPOINT } from '@/config';
import { priceFormatter } from '@/utils/price';
import { socket } from '@/utils/socket';
import { useMainContext } from '@/context';
import { AssetUtil, ChainController } from "@reown/appkit-controllers"

// import { socket } from '../../utils/socket';

const Container = styled(Box)`
  border-radius: 12px;
  overflow: hidden;
  background: #FFF2;
  position: relative;
  height: 500px;
  &:before {
    content: '';
    position: absolute;
    top: 36px;
    left: 0;
    right: 0;
    bottom: 0;
    background: url(/images/logo.png) no-repeat center;
    opacity: 0.3;
    filter: grayscale(0.7);
    z-index: 0;
  }
  iframe {
    position: relative;
    z-index: 1;
  }
`;

const getLanguageFromURL = (): LanguageCode | null => {
    const regex = new RegExp('[\\?&]lang=([^&#]*)');

    // eslint-disable-next-line no-restricted-globals
    const results = regex.exec(location.search);
    return results === null ? null : decodeURIComponent(results[1].replace(/\+/g, ' ')) as LanguageCode;
};

const lastBarsCache = new Map()
const channelToSubscription = new Map()

// function getSeconds(resolution: ResolutionString) {
//     const RESOLUTIONS: any = {
//         's': 1, 'd': 86400, 'w': 604800, 'm': 2592000, 'y': 31536000
//     }
//     const match = /^(\d*)(\D*)$/.exec(resolution.toLowerCase())
//     return Number(match?.[1] ?? 1) * Number(match?.[2] ? RESOLUTIONS[match[2]] : 60)
// }

// Jupiter API helper functions
const JUPITER_BASE_URL = 'https://datapi.jup.ag';

// Resolution mapping for Jupiter API
const getJupiterInterval = (resolution: ResolutionString): string => {
    const resolutionMap: { [key: string]: string } = {
        '1': '1_MINUTE',
        '5': '5_MINUTE',
        '15': '15_MINUTE',
        '30': '30_MINUTE',
        '60': '1_HOUR',
        '1D': '1_DAY',
        '1W': '1_WEEK',
        '1M': '1_MONTH'
    };
    return resolutionMap[resolution ?? '1']
};

// Transform Jupiter candle data to TradingView format
const transformJupiterCandles = (candles: any[]) => {
    return candles.map(candle => ({
        time: candle.time * 1000, // Convert to milliseconds
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
    }));
};

const fetchChartData = async (network: string, params: any) => {
    try {
        if (network === 'solana') {
            const { tokenAddress, interval, from, to, countBack } = params;
            const jupiterInterval = getJupiterInterval(interval);

            const response = await axios.get(`${JUPITER_BASE_URL}/v2/charts/${tokenAddress}`, {
                params: {
                    baseAsset: tokenAddress,
                    from: from * 1000, // Convert to milliseconds
                    to: to * 1000,
                    interval: jupiterInterval,
                    candles: countBack || 100,
                    type: 'price'
                }
            });

            if (response.data && response.data.candles) {
                return response.data.candles;
            }
        } else {
            const { data } = await axios.get(`${API_ENDPOINT}/trades/getChartData`, { params })
            return data
        }
        return 'nodata';
    } catch (error) {
        console.error('Error fetching Solana chart data:', error);
        return 'nodata';
    }
}

export const TVChartContainer = ({ token, network, dex, ...props }: any) => {
    const chartContainerRef = useRef<HTMLDivElement | string>("")
    const isMobile = useMediaQuery('(max-width: 800px)')
    const { chains } = useMainContext()
    const tokenChain = React.useMemo(() => chains?.find(c => c.network === network), [chains, network])
    const networks = ChainController.getCaipNetworks()
    const tokenNetwork = React.useMemo(() => {
        return networks.find(n => n.id === tokenChain?.chainId || n.chainNamespace === tokenChain?.chainId)
    }, [networks, tokenChain])

    const dataFeed = React.useMemo(() => ({
        onReady: (callback: any) => {
            callback({
                supported_resolutions: ['1', '15', '1D', '1W', '1M'],
                exchanges: [
                    { value: 'Uniswap', name: 'Uniswap', desc: 'Uniswap exchange' },
                ],
                symbols_types: [
                    { name: 'crypto', value: 'crypto' }
                ]
            })
        },
        searchSymbols: () => {
        },
        resolveSymbol: (symbolName: string, onSymbolResolvedCallback: any, onResolveErrorCallback: any, extension: any) => {
            axios.get(`${API_ENDPOINT}/tokens/${network}/${token}`)
                .then(async function ({ data: { tokenDetils: tokenDetails } }) {
                    // console.log(extension)
                    const symbolInfo = {
                        address: tokenDetails.tokenAddress,
                        // address: dex ? tokenDetails.pairAddresses[dex] : tokenDetails.tokenAddress,
                        ticker: tokenDetails.tokenSymbol,
                        name: tokenDetails.tokenName,
                        description: `${tokenDetails.tokenSymbol} / ${tokenNetwork?.nativeCurrency.symbol}`,
                        launchedAt: tokenDetails.launchedAt,
                        type: 'crypto',
                        session: '24x7',
                        timezone: 450,
                        dex,
                        network,
                        exchange: dex ?? 'Forge Finance',
                        // logo_urls: [`${IPFS_GATEWAY_URL}${tokenDetails.tokenImage}`],
                        logo_urls: [`${API_ENDPOINT}/logo/${tokenDetails.tokenImage}`],
                        minmov: 1,
                        pricescale: 1e12,
                        // volumescale: 1e2,
                        has_intraday: true,
                        // visible_plots_set: tokenDetails.launchedAt ? 'ohlcv' : 'ohlc',
                        has_weekly_and_monthly: false,
                        supported_resolutions: ['1', '15', '1D', '1W', '1M'],
                        volume_precision: 2,
                        data_status: 'streaming',
                        // has_empty_bars: true,
                    };
                    onSymbolResolvedCallback(symbolInfo);
                }).catch(() => { })
        },
        getBars: (symbolInfo: any, resolution: any, periodParams: any, onHistoryCallback: any, onErrorCallback: any) => {
            const { from, to, firstDataRequest, countBack } = periodParams;
            if (from > 0) {
                fetchChartData(symbolInfo.network, {
                    tokenAddress: symbolInfo.address,
                    interval: resolution,
                    from: symbolInfo.dex ? new Date(symbolInfo.launchedAt).getTime() / 1000 : from,
                    to,
                    countBack,
                    ...(firstDataRequest ? { first: 1 } : {}),
                    dex: symbolInfo.dex
                }).then((data) => {
                    if (data === 'nodata') {
                        onHistoryCallback([], { noData: true })
                    } else {
                        const bars = data.map((d: any) => ({ ...d, time: d.time * 1000, volume: Number(d.volume) }))
                        if (firstDataRequest && bars.length) {
                            lastBarsCache.set(`${symbolInfo.exchange}:${symbolInfo.name}`, { ...bars[bars.length - 1] });
                        }
                        onHistoryCallback(bars, { noData: false })
                    }
                }).catch(ex => {
                    onErrorCallback(ex)
                })
            }
        },
        subscribeBars: (
            symbolInfo: any,
            resolution: any,
            onRealtimeCallback: any,
            subscriberUID: any,
            onResetCacheNeededCallback: any
        ) => {
            if (symbolInfo.launchedAt && !symbolInfo.dex)
                return
            const lastDailyBar = lastBarsCache.get(`${symbolInfo.exchange}:${symbolInfo.name}`)
            const handler = {
                id: subscriberUID,
                callback: onRealtimeCallback,
            };
            let subscriptionItem = channelToSubscription.get(token);
            if (subscriptionItem) {
                // Already subscribed to the channel, use the existing subscription
                subscriptionItem.handlers.push(handler);
                return;
            }
            subscriptionItem = {
                subscriberUID,
                resolution,
                lastDailyBar,
                address: symbolInfo.address,
                dex: symbolInfo.dex,
                handlers: [handler],
            };
            channelToSubscription.set(token, subscriptionItem);
            socket.emit('SubAdd', { address: symbolInfo.address, dex: symbolInfo.dex });
        },
        unsubscribeBars: (subscriberUID: any) => {
            const subscriptionItem = channelToSubscription.get(token);
            const handlerIndex = subscriptionItem.handlers
                .findIndex((handler: any) => handler.id === subscriberUID);

            if (handlerIndex !== -1) {
                // Remove from handlers
                subscriptionItem.handlers.splice(handlerIndex, 1);

                if (subscriptionItem.handlers.length === 0) {
                    // Unsubscribe from the channel if it is the last handler
                    channelToSubscription.delete(token);
                    socket.emit('SubRemove', { address: subscriptionItem.address });
                }
            }
        },
    }), [token, dex, network])

    // const socket = React.useMemo(() => io(API_ENDPOINT, {
    //     autoConnect: true,
    //     reconnectionDelayMax: 1000,
    // }), [])

    useEffect(() => {
        socket.on('connect', () => {
            const item = channelToSubscription.get(token)
            if (item)
                socket.emit('SubAdd', { address: item.address, dex: item.dex })
        })
        socket.on('m', data => {
            const subscriptionItem = channelToSubscription.get(token);
            if (!subscriptionItem)
                return
            const items = data.split('\n').map((item: string) => {
                const [
                    tokenAddress,
                    timeStr,
                    tradePriceStr,
                    tradeVolumeStr,
                ] = item.split('~')
                if (tokenAddress !== subscriptionItem.address)
                    return undefined
                return [
                    timeStr,
                    tradePriceStr,
                    tradeVolumeStr,
                ]
            }).filter(Boolean)

            if (items.length === 0)
                return

            const [
                timeStr,
                tradePriceStr,
                tradeVolumeStr,
            ] = items[0]

            const tradePrice = parseFloat(tradePriceStr);
            if (subscriptionItem === undefined) {
                return;
            }
            const lastDailyBar = subscriptionItem.lastDailyBar;
            // const nextDailyBarTime = lastDailyBar?.time ? lastDailyBar.time + subscriptionItem.resolution * 60000 : tradeTime;
            const tradeTime = Math.floor(Number(timeStr) / (subscriptionItem.resolution * 60)) * (subscriptionItem.resolution * 60000);
            const curTime = Math.floor(Date.now() / (subscriptionItem.resolution * 60000)) * (subscriptionItem.resolution * 60000);

            console.log('[socket] Message:', data, tradeTime, curTime, tradePriceStr);

            let bar: any;
            if (!lastDailyBar) {
                bar = {
                    time: curTime,
                    open: tradePrice,
                    high: tradePrice,
                    low: tradePrice,
                    close: tradePrice,
                    volume: Number(tradeVolumeStr ?? 0)
                };
            } else if (lastDailyBar.time < tradeTime) {
                bar = {
                    time: tradeTime,
                    open: lastDailyBar.close,
                    high: Math.max(lastDailyBar.close, tradePrice),
                    low: Math.min(lastDailyBar.close, tradePrice),
                    close: tradePrice,
                    volume: Number(tradeVolumeStr ?? 0)
                };
            } else {
                bar = {
                    ...lastDailyBar,
                    high: Math.max(lastDailyBar.high, tradePrice),
                    low: Math.min(lastDailyBar.low, tradePrice),
                    close: tradePrice,
                    volume: Number(tradeVolumeStr ?? 0)
                };
            }
            subscriptionItem.lastDailyBar = bar;

            // Send data to every subscriber of that symbol
            subscriptionItem.handlers.forEach((handler: any) => handler.callback(bar));
        })
        return () => {
            socket.off('m')
        }
    }, [socket, token])

    useEffect(() => {
        if (!token || !dataFeed)
            return
        const widgetOptions: ChartingLibraryWidgetOptions = {
            symbol: token,
            // BEWARE: no trailing slash is expected in feed URL
            // tslint:disable-next-line:no-any
            datafeed: dataFeed, // new (window as any).Datafeeds.UDFCompatibleDatafeed(defaultProps.datafeedUrl),
            interval: '1' as ResolutionString,
            container: chartContainerRef.current,
            // toolbar_bg: "#191919",
            library_path: '/charting_library/',
            locale: getLanguageFromURL() || 'en',
            disabled_features: [
                'use_localstorage_for_settings',
                'header_symbol_search',
                'header_compare',
                'header_undo_redo',
                'header_quick_search',
                'header_fullscreen_button',
                'header_indicators',
                'header_settings',
                'header_screenshot',
                'symbol_search_hot_key',
                'save_chart_properties_to_local_storage',
                'legend_context_menu',
                'legend_inplace_edit',
                'symbol_info',
                'left_toolbar',
            ],
            enabled_features: [
                // 'symbol_info_price_source',
                // 'show_symbol_logos',
                // 'show_symbol_logo_in_legend',
                'request_only_visible_range_on_reset',
                'iframe_loading_compatibility_mode',
                'hide_resolution_in_legend',
            ],
            fullscreen: false,
            autosize: true,
            // studies_overrides: {
            //     'volume.': 15
            // },
            theme: 'dark',
            custom_formatters: {
                priceFormatterFactory: (symbolInfo, minTick) => {
                    return {
                        format: (price, signPositive) => {
                            return priceFormatter(price, 18, false, false);
                        }
                    }
                },
            },
            overrides: {
                'paneProperties.backgroundType': 'solid',
                'paneProperties.background': '#212121',
                'paneProperties.vertGridProperties.color': '#191919',
                'paneProperties.horzGridProperties.color': '#191919',
                'scalesProperties.fontSize': isMobile ? 5 : 12,
            }
        };

        const tvWidget = new widget(widgetOptions);
        // const document = tvWidget.._iFrame.contentDocument
        tvWidget.setCSSCustomProperty('--tv-color-platform-background', '#191919')
        tvWidget.setCSSCustomProperty('--tv-color-pane-background', '#21212180')
        tvWidget.setCSSCustomProperty('--tv-color-popup-background', '#121212')
        // tvWidget.setCSSCustomProperty('--ui-lib-button-color-bg', 'white')
        // tvWidget.setCSSCustomProperty('--ui-lib-button-color-border', 'white')
        return () => {
            tvWidget.remove();
        };
    }, [token, dataFeed]);

    return (
        <Container ref={chartContainerRef} {...props} />
    );
};