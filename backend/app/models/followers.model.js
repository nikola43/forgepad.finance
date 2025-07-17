module.exports = (sequelize, Sequelize) => {
  const followers = sequelize.define("followers", {
    followerId: {
      type: Sequelize.STRING(50)
    },
    followeeId: {
      type: Sequelize.STRING(50)
    },
    followedAt: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW
    },
  }, {
    indexes: [
      {
        unique: true,
        fields: ['followerId', 'followeeId']
      }
    ]
  });

  return followers;
};
