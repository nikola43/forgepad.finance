module.exports = (sequelize, Sequelize) => {
  const trades = sequelize.define("trades", {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    tokenName: {
      type: Sequelize.STRING
    },
    tokenSymbol: {
      type: Sequelize.STRING
    },
    tokenAddress: {
      type: Sequelize.STRING(50)
    },
    tokenImage: {
      type: Sequelize.STRING
    },
    swapperAddress: {
      type: Sequelize.STRING(50)
    },
    type: {
      type: Sequelize.STRING
    },
    ethAmount: {
      type: Sequelize.DECIMAL(65, 18)
    },
    tokenAmount: {
      type: Sequelize.DECIMAL(65, 18)
    },
    network: {
      type: Sequelize.STRING
    },
    date: {
      type: Sequelize.INTEGER,
    },
    txHash: {
      type: Sequelize.STRING(66)
    },
    ethPrice: {
      type: Sequelize.DECIMAL(65, 18),
      defaultValue: 0.0
    },
    tokenPrice: {
      type: Sequelize.DECIMAL(65, 18),
      defaultValue: 0.0
    }
  }, {
    indexes: [
      {
        unique: true,
        fields: ['txHash']
      }
    ]
  });

  return trades;
};
