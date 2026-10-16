
const sql = require("mssql/msnodesqlv8");

const config = {
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_NAME || "FomsiLighting",
 driver: "ODBC Driver 18 for SQL Server",
  options: {
    trustedConnection: true,
    trustServerCertificate:
      process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
  },
  connectionTimeout: 15000,
  requestTimeout: 15000,
};

let poolPromise;

async function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .catch((error) => {
        poolPromise = null;
        throw error;
      });
  }

  return poolPromise;
}

module.exports = { sql, getPool };