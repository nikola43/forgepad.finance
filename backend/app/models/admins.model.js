module.exports = (sequelize, Sequelize) => {
  const admins = sequelize.define("admins", {
    address: {
      type: Sequelize.STRING(50)
    },
    penalized: {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    },
  }, {
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['address']
      }
    ]
  });
  return admins;
};
