import type { Knex } from "knex";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

type DbDialect = "pg" | "mssql" | "mysql2";

function getDialect(): DbDialect {
  const dialect = (process.env.DB_DIALECT || "mssql").toLowerCase();
  if (dialect === "mssql" || dialect === "sqlserver") return "mssql";
  if (dialect === "mysql" || dialect === "mysql2") return "mysql2";
  return "pg";
}

function buildConfig(dialect: DbDialect): Knex.Config {
  const common = {
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "xeonb_crm",
    user: process.env.DB_USER || (dialect === "pg" ? "postgres" : "sa"),
    password: process.env.DB_PASSWORD || "",
  };

  const portDefaults: Record<DbDialect, number> = {
    pg: 5432,
    mssql: 1433,
    mysql2: 3306,
  };
  const port = parseInt(process.env.DB_PORT || String(portDefaults[dialect]));

  const connection =
    dialect === "mssql"
      ? {
          server: common.host,
          port,
          database: common.database,
          user: common.user,
          password: common.password,
          options: { encrypt: false, trustServerCertificate: true },
        }
      : {
          host: common.host,
          port,
          database: common.database,
          user: common.user,
          password: common.password,
        };

  return {
    client: dialect,
    connection,
    pool: { min: 2, max: 20 },
    migrations: {
      directory: path.join(__dirname, "src/server/database/migrations"),
      extension: "ts",
    },
  };
}

const dialect = getDialect();

const config: { [key: string]: Knex.Config } = {
  development: buildConfig(dialect),
  production: buildConfig(dialect),
};

export default config;
