module.exports = (sequelize, Sequelize) => {
  const chats = sequelize.define("chats", {
    tokenAddress: {
      type: Sequelize.STRING(50)
    },
    replyAddress: {
      type: Sequelize.STRING(50)
    },
    network: {
      type: Sequelize.STRING
    },
    comment: {
      type: Sequelize.TEXT
    },
    code: {
      type: Sequelize.STRING,
    },
    date: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW
    }
  });
  return chats;
};
