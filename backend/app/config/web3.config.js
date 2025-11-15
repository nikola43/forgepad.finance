const dotenv = require('dotenv');
dotenv.config();

const abiEthism = {
  v1: require('../listeners/EthismV1.json')
}

const idlMeteoraDBC = {
  v1: require('../listeners/MeteoraDBC.json')
}

const CHAINS = [
  // {
  //   name: 'Ethereum',
  //   network: 'mainnet',
  //   chainId: 1,
  //   currency: 'ETH',
  //   rpcUrl: 'https://rpc.ankr.com/eth/21abecc585cbd8eb9f1fb38ee79dff11d3b3d8dafbca2589236ea7dcc4d88593',
  //   explorerUrl: 'https://etherscan.io',
  //   contractAddress: '0xBe246D0eBD173486B0b50961159eE053f753Df4f',
  //   abi: abiEthism.v1,
  //   virtualEthAmount: 1.2,
  //   virtualTokenAmount: 800000000,
  //   totalSupply: 1000000000,
  //   targetMarketCap: 69000,
  //   pools: ['uniswap:v2', 'uniswap:v3', 'uniswap:v4']
  // },
  // {
  //   name: 'Base',
  //   network: 'base',
  //   chainId: 8453,
  //   currency: 'ETH',
  //   rpcUrl: 'https://rpc.ankr.com/base/21abecc585cbd8eb9f1fb38ee79dff11d3b3d8dafbca2589236ea7dcc4d88593',
  //   explorerUrl: 'https://basescan.org',
  //   contractAddress: '0xa348f2f1ac90350d587c0c1ef85b8bec3a066762',
  //   abi: abiEthism.v1,
  //   virtualEthAmount: 1.2,
  //   virtualTokenAmount: 800000000,
  //   totalSupply: 1000000000,
  //   targetMarketCap: 69000,
  //   pools: ['uniswap:v2', 'uniswap:v3', 'uniswap:v4']
  // },
  {
    name: 'BSC',
    network: 'bsc',
    chainId: 56,
    currency: 'BNB',
    rpcUrl: 'https://bsc-rpc.publicnode.com',
    // rpcUrl: 'https://rpc.ankr.com/bsc/21abecc585cbd8eb9f1fb38ee79dff11d3b3d8dafbca2589236ea7dcc4d88593',
    explorerUrl: 'https://bscscan.com',
    contractAddress: '0xAe98b6658d7477EbaCe6994440796F2cB57bF82e',
    abi: abiEthism.v1,
    virtualEthAmount: 6,
    virtualTokenAmount: 900000000,
    totalSupply: 1000000000,
    targetMarketCap: 60000,
    pools: ['pancakeswap:v2']
  },
  // {
  //   name: 'Solana',
  //   network: 'solana',
  //   chainId: 'solana',
  //   rpcUrl: 'https://api.mainnet-beta.solana.com',
  //   contractAddress: 'DHNMh7nbtfJEgRoS4K352RciA2r6RiNusGx2ry6DF778',
  //   idl: idlMeteoraDBC.v1,
  //   virtualEthAmount: 1.766,
  //   virtualTokenAmount: 1076000000,
  //   totalSupply: 1000000000,
  //   targetMarketCap: 69000,
  //   pools: ['meteora']
  // },
]

module.exports = {
  CHAINS
};
