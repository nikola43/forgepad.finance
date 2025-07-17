module.exports = (sequelize, Sequelize) => {
  const admins = sequelize.define("admins", {
    address: {
      type: Sequelize.STRING(50)
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
