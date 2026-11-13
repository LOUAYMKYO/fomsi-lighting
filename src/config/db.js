
const { Pool } = require("pg");
require("dotenv").config();

console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);
console.log(
    "DATABASE_URL host:",
    process.env.DATABASE_URL
        ? (() => {
            try {
                return new URL(process.env.DATABASE_URL).hostname;
            } catch {
                return "INVALID URL";
            }
        })()
        : "MISSING"
);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
});

async function getPool() {
    return pool;
}

async function testConnection() {
    try {
        const result = await pool.query("SELECT NOW() AS current_time");
        console.log("NEON DATABASE CONNECTED:", result.rows[0].current_time);
    } catch (error) {
        console.error("NEON CONNECTION TEST FAILED:", {
            message: error.message,
            code: error.code,
            address: error.address,
            port: error.port,
            syscall: error.syscall
        });
    }
}

testConnection();

module.exports = { getPool };
