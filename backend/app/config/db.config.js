const dotenv = require('dotenv');
dotenv.config();

// Parse Supabase PostgreSQL URL
const parseSupabaseUrl = (url) => {
  if (!url) {
    throw new Error('SUPABASE_URL is not defined in environment variables');
  }

  // URL format: postgresql://user:password@host:port/database?params
  const regex = /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/;
  const match = url.match(regex);

  if (!match) {
    throw new Error('Invalid Supabase URL format');
  }

  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: match[4],
    database: match[5]
  };
};

const supabaseConfig = parseSupabaseUrl(process.env.SUPABASE_URL);

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
