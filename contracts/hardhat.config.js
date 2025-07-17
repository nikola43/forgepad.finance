/**
 * @type import('hardhat/config').HardhatUserConfig
 */
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ganache");
// require("@openzeppelin/hardhat-upgrades");
require("@nomiclabs/hardhat-ethers");
// require("@nomiclabs/hardhat-etherscan");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();
require("hardhat-gas-reporter");

module.exports = {
    solidity: {
        compilers: [
            {
                version: "0.8.28",
                settings: {
                    evmVersion: "cancun",
                    optimizer: {
                        enabled: true,
                        runs: 1,
                    },
                    viaIR: true,
                },

            },
            {
                version: "0.8.26",
                settings: {
                    evmVersion: "cancun",
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    viaIR: true,
                },
            },
        ],
    },
    networks: {
        hardhat: {
            forking: {
                url: `https://eth.llamarpc.com`
            },
            accounts: {
                accountsBalance: '1000000000000000000000000000000000000000'
            },
            gasPrice: 6510331748

        },
        localhost: {
            forking: {
                url: `https://eth.llamarpc.com`,
            },
            gasPrice: 6510331748
        },
        pulsechainmainnet: {
            url: "https://rpc-pulsechain.g4mm4.io",
            accounts: [process.env.PRIVATE_KEY],
            chainId: 0x171
        },
        pulsechaintestnet: {
            url: "https://rpc.v4.testnet.pulsechain.com",
            accounts: [process.env.PRIVATE_KEY],
            chainId: 0x3AF
        },
        bsc_test: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545",
            accounts: [process.env.PRIVATE_KEY],
        },
        arbitrum: {
            url: "https://arb1.arbitrum.io/rpc",
            accounts: [process.env.PRIVATE_KEY],
            chainId: 0xa4b1
        },
        base: {
            url: "https://rpc.ankr.com/base/21abecc585cbd8eb9f1fb38ee79dff11d3b3d8dafbca2589236ea7dcc4d88593",
            accounts: [process.env.PRIVATE_KEY],
            chainId: 0x2105
        },
        avalanche: {
            url: "https://api.avax.network/ext/bc/C/rpc",
            accounts: [process.env.PRIVATE_KEY],
            chainId: 0xa86a
        },
        sepolia: {
            url: "https://sepolia.infura.io/v3/45eb256800c24b6c854fb8cd4c73b2c3",
            accounts: [process.env.PRIVATE_KEY],
        },
        bsc_main: {
            url: "https://bsc-dataseed1.binance.org",
            accounts: [process.env.PRIVATE_KEY],
        },
        eth_main: {
            url: "https://eth.merkle.io",
            accounts: [process.env.PRIVATE_KEY],
            // gas: 15000000,        // Much higher
            // gasPrice: 2500000000, // 25 gwei (2 gwei is too low for mainnet)
        },
        eth_main: {
            url: "https://eth.merkle.io",
            accounts: [process.env.PRIVATE_KEY],
            // gas: 15000000,        // Much higher
            // gasPrice: 2500000000, // 25 gwei (2 gwei is too low for mainnet)
        },
        eth_mainnet: {
            url: "https://rpc.ankr.com/eth/21abecc585cbd8eb9f1fb38ee79dff11d3b3d8dafbca2589236ea7dcc4d88593",
            accounts: [process.env.PRIVATE_KEY],
            // gas: 15000000,        // Much higher
            // gasPrice: 2500000000, // 25 gwei (2 gwei is too low for mainnet)
        },
    },
    mocha: {
        timeout: 1000000000,
    },
    etherscan: {
        apiKey: {
            sepolia: process.env.ETHERSCAN_API_KEY,
            bsc: process.env.BSCSCAN_API_KEY,
            pulsechainmainnet: 'pulsechainmainnet',
            pulsechaintestnet: 'pulsechaintestnet',
            base: '9AJVKWM6M31X24NEYBI93SYW99IVDI5ZCG',
            mainnet: "ZF8UZTCMKDNN555XW2CGBJ2HXWCVIRZFFG",
            eth_mainnet: 'eth_mainnet',
        },
        customChains: [
            {
                network: "eth_mainnet",
                chainId: 1,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=1",
                    browserURL: "https://etherscan.io"
                }
            },
            {
                network: "base",
                chainId: 8453,
                urls: {
                    apiURL: "https://api.scan.v4.testnet.pulsechain.com/api/v1",
                    browserURL: "https://scan.v4.testnet.pulsechain.com"
                }
            },
            {
                network: "pulsechaintestnet",
                chainId: 943,
                urls: {
                    apiURL: "https://api.scan.v4.testnet.pulsechain.com/api/v1",
                    browserURL: "https://scan.v4.testnet.pulsechain.com"
                }
            },
            {
                network: "pulsechainmainnet",
                chainId: 369,
                urls: {
                    apiURL: "https://api.scan.pulsechain.com/api/v1",
                    browserURL: "https://scan.pulsechain.com"
                }
            }
        ]
    },
    gasReporter: {
        token: "ETH",
        currency: 'USD',
        gasPrice: 3,
        enabled: true,
        coinmarketcap: '0caa3779-3cb2-4665-a7d3-652823b53908'
    },
    sourcify: {
        enabled: true
    }
};
