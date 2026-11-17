const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('connect', () => {
  console.log('Base de datos conectada con éxito a Supabase');
});

pool.on('error', (err) => {
  console.error('Error inesperado en la base de datos inactiva', err);
  process.exit(-1);
});

module.exports = pool;