module.exports = (sequelize, Sequelize) => {
  const users = sequelize.define("users", {
    username: {
      type: Sequelize.STRING
    },
    address: {
      type: Sequelize.STRING(50)
    },
    bio: {
      type: Sequelize.STRING
    },
    avatar: {
      type: Sequelize.STRING
    },
    likes: {
      type: Sequelize.INTEGER,
      defaultValue: 0
    },
    creationTime: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW
    },
    twitter_id: {
      type: Sequelize.STRING(64)
    },
    twitter_name: {
      type: Sequelize.STRING(64)
    },
    twitter_username: {
      type: Sequelize.STRING(64)
    },
    twitter_access: {
      type: Sequelize.STRING(100)
    },
    twitter_profile_picture: {
      type: Sequelize.STRING(200)
    },
    twitter_verified: {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    },
    updateTime: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW
    },
  });
  return users;
};
