const { CHAINS } = require("../config/web3.config");

module.exports = (sequelize, Sequelize) => {
  const tokens = sequelize.define("tokens", {
    tokenName: {
      type: Sequelize.STRING(60)
    },
    tokenSymbol: {
      type: Sequelize.STRING(30)
    },
    tokenAddress: {
      type: Sequelize.STRING(50)
    },
    tokenDescription: {
      type: Sequelize.TEXT
    },
    tokenImage: {
      type: Sequelize.STRING
    },
    tokenBanner: {
      type: Sequelize.STRING
    },
    marketcap: {
      type: Sequelize.DECIMAL(65, 18),
      defaultValue: 0
    },
    price: {
      type: Sequelize.DECIMAL(65, 18),
      defaultValue: 0
    },
    pairAddress: {
      type: Sequelize.STRING(50)
    },
    ethPrice: {
      type: Sequelize.DECIMAL(65, 18),
      defaultValue: 0
    },
    virtualEthAmount: {
      type: Sequelize.DECIMAL(65, 18),
      defaultValue: 0
    },
    virtualTokenAmount: {
      type: Sequelize.DECIMAL(65, 18),
      defaultValue: 0
    },
    liquidity: {
      type: Sequelize.VIRTUAL,
      get() {
        return (Number(this.virtualEthAmount) * Number(this.ethPrice))
      },
    },
    volume: {
      type: Sequelize.DECIMAL(65, 18),
      defaultValue: 0
    },
    score: {
      type: Sequelize.DECIMAL(65, 18),
      defaultValue: 0
    },
    progress: {
      type: Sequelize.VIRTUAL,
      get() {
        const chain = CHAINS.find(chain => chain.network === this.network)
        if (!chain)
          return 0
        try {
          const amount = Math.sqrt(chain.targetMarketCap * Number(this.virtualEthAmount) * Number(this.virtualTokenAmount) / Number(this.ethPrice) / chain.totalSupply) - Number(this.virtualEthAmount)
          return (Number(this.virtualEthAmount) - chain.virtualEthAmount) * 100 / (Number(this.virtualEthAmount) - Number(chain.virtualEthAmount) + amount)
          // const a = chain.totalSupply * Number(this.ethPrice)
          // const b = 2 * a * Number(this.virtualEthAmount) - a * chain.virtualEthAmount - chain.targetMarketCap * chain.totalSupply + chain.targetMarketCap * chain.virtualTokenAmount
          // const c = a * Number(this.virtualEthAmount) * Number(this.virtualEthAmount) - a * chain.virtualEthAmount * Number(this.virtualEthAmount) - chain.targetMarketCap * Number(this.virtualEthAmount) * (Number(this.virtualTokenAmount) - chain.virtualTokenAmount + chain.totalSupply)
          // const amount = (Math.sqrt(b * b - 4 * a * c) - b) / a / 2
          // return (Number(this.virtualEthAmount) - chain.virtualEthAmount) * 100 / (Number(this.virtualEthAmount) - Number(chain.virtualEthAmount) + amount)
        } catch(ex) {
          console.error(ex)
          return 0
        }
      },
    },
    priceChange: {
      type: Sequelize.VIRTUAL,
      get() {
        const chain = CHAINS.find(chain => chain.network === this.network)
        if (!chain)
          return 0
        const price = chain.virtualEthAmount / chain.virtualTokenAmount
        return (Number(this.price) - price) * 100 / price
      },
    },
    creatorAddress: {
      type: Sequelize.STRING(50)
    },
    network: {
      type: Sequelize.STRING
    },
    poolType: {
      type: Sequelize.INTEGER,
      defaultValue: 1,
    },
    category: {
      type: Sequelize.INTEGER,
      defaultValue: 0
    },
    replies: {
      type: Sequelize.INTEGER,
      defaultValue: 0
    },
    webLink: {
      type: Sequelize.STRING
    },
    telegramLink: {
      type: Sequelize.STRING
    },
    twitterLink: {
      type: Sequelize.STRING
    },
    creationTime: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW
    },
    updateTime: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW
    },
    launchedAt: {
      type: Sequelize.DATE
    },
  }, {
    indexes: [
      {
        unique: true,
        fields: ['tokenAddress']
      }
    ]
  });

  return tokens;
};
