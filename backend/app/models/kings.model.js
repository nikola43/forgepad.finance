module.exports = (sequelize, Sequelize) => {
  const kings = sequelize.define("kings", {
    tokenAddress: Sequelize.STRING(50),
  });
  return kings;
};
