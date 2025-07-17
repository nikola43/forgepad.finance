const dotenv = require('dotenv');
dotenv.config();

const abiEthism = {
  v1: require('../listeners/EthismV1.json')
}

const idlMeteoraDBC = {
  v1: require('../listeners/MeteoraDBC.json')
}

const CHAINS = [
  {
    name: 'Ethereum',
    network: 'mainnet',
    chainId: 1,
    currency: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/eth/21abecc585cbd8eb9f1fb38ee79dff11d3b3d8dafbca2589236ea7dcc4d88593',
    explorerUrl: 'https://etherscan.io',
    contractAddress: '0x034dE400A1adF5E215D75b04a095F10786687b9f',
    abi: abiEthism.v1,
    virtualEthAmount: 5,
    virtualTokenAmount: 600000000,
    totalSupply: 1000000000,
    targetMarketCap: 69000,
    pools: ['uniswap:v2', 'uniswap:v3', 'uniswap:v4']
  },
  {
    name: 'Base',
    network: 'base',
    chainId: 8453,
    currency: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/base/21abecc585cbd8eb9f1fb38ee79dff11d3b3d8dafbca2589236ea7dcc4d88593',
    explorerUrl: 'https://basescan.org',
    contractAddress: '0x4f2580738917c4b2bF862994eC1c223d66857104',
    abi: abiEthism.v1,
    virtualEthAmount: 1.766,
    virtualTokenAmount: 1076000000,
    totalSupply: 1000000000,
    targetMarketCap: 30000,
    pools: ['uniswap:v2', 'uniswap:v3', 'uniswap:v4']
  },
  {
    name: 'Solana',
    network: 'solana',
    chainId: 'solana',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    contractAddress: 'DHNMh7nbtfJEgRoS4K352RciA2r6RiNusGx2ry6DF778',
    idl: idlMeteoraDBC.v1,
    virtualEthAmount: 1.766,
    virtualTokenAmount: 1076000000,
    totalSupply: 1000000000,
    targetMarketCap: 69000,
    pools: ['meteora']
  },
]

module.exports = {
  CHAINS
};
