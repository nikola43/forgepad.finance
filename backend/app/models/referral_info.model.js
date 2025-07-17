module.exports = (sequelize, Sequelize) => {
  const referralInfo = sequelize.define("referral_info", {
    referral_code: {
      type: Sequelize.STRING(10)
    },
    address: {
      type: Sequelize.STRING(50),
    },
    earnings: {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
  });
  return referralInfo;
};
