module.exports = (sequelize, Sequelize) => {
  const indexing = sequelize.define("indexing", {
    network: Sequelize.INTEGER,
    block: Sequelize.INTEGER
  }, {
    indexes: [
      {
        unique: true,
        fields: ['network']
      }
    ]
  });
  return indexing;
};
