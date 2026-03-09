const dotenv = require('dotenv');
dotenv.config();

// Parse Supabase PostgreSQL URL
const parseSupabaseUrl = (url) => {
  if (!url) return null;
  const regex = /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/;
  const match = url.match(regex);
  if (!match) return null;
  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: match[4],
    database: match[5]
  };
};

// Use local MySQL if DB_DIALECT=mysql, otherwise fall back to Supabase PostgreSQL
const useMySQL = process.env.DB_DIALECT === 'mysql';

if (useMySQL) {
  module.exports = {
    HOST: process.env.DB_HOST || 'localhost',
    USER: process.env.DB_USER || 'root',
    PASSWORD: process.env.DB_PASSWORD || '',
    DB: process.env.DB_NAME || 'ethism',
    dialect: "mysql",
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    dialectOptions: {},
    PORT: process.env.DB_PORT || 3306
  };
} else {
  const supabaseConfig = parseSupabaseUrl(process.env.SUPABASE_URL);
  if (!supabaseConfig) {
    throw new Error('SUPABASE_URL is not defined or invalid, and DB_DIALECT is not set to mysql');
  }
  module.exports = {
    HOST: supabaseConfig.host,
    USER: supabaseConfig.user,
    PASSWORD: supabaseConfig.password,
    DB: supabaseConfig.database,
    dialect: "postgres",
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
    PORT: supabaseConfig.port
  };
}
