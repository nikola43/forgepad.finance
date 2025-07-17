module.exports = (sequelize, Sequelize) => {
  const trades = sequelize.define("holders", {
    tokenName: {
      type: Sequelize.STRING(60)
    },
    tokenSymbol: {
      type: Sequelize.STRING(30)
    },
    tokenAddress: {
      type: Sequelize.STRING(50)
    },
    holderAddress: {
      type: Sequelize.STRING(50)
    },
    tokenAmount: {
      type: Sequelize.DECIMAL(65, 18)
    },
    network: {
      type: Sequelize.STRING(25)
    },
    creatorAddress: {
      type: Sequelize.STRING(50)
    }
  }, {
    indexes: [
      {
        unique: true,
        fields: ['tokenAddress', 'holderAddress']
      }
    ]
  }
  );

  return trades;
};
