module.exports = (sequelize, Sequelize) => {
  const followees = sequelize.define("followees", {
    id: {
      type: Sequelize.STRING(50),
      primaryKey: true,
    },
    followers: {
      type: Sequelize.INTEGER
    },
  });

  return followees;
};
