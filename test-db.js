
require("dotenv").config();

const { getPool } = require("./src/config/db");

async function testDatabase() {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        DB_NAME() AS databaseName,
        SUSER_SNAME() AS sqlLogin
    `);

    console.log("SQL Server connected successfully!");
    console.log(result.recordset[0]);

    await pool.close();
  } catch (error) {
    console.error("Database connection failed:");
    console.error(error.message);
    process.exitCode = 1;
  }
}

testDatabase();