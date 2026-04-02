module.exports = (sequelize, Sequelize) => {
  const referrals = sequelize.define("referrals", {
    referrer: {
      type: Sequelize.STRING(50)
    },
    referee: {
      type: Sequelize.STRING(50)
    }
  });
  return referrals;
};
