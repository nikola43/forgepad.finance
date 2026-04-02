module.exports = (sequelize, Sequelize) => {
  return sequelize.define("requests", {
    address: {
      type: Sequelize.STRING(50)
    },
    body: {
      type: Sequelize.TEXT
    },
  });
};
