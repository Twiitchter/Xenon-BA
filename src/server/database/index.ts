import Knex, { Knex as KnexType } from 'knex';
import bcrypt from 'bcrypt';
import path from 'path';

export type DbDialect = 'pg' | 'mssql' | 'mysql2';

function getDialect(): DbDialect {
  const dialect = (process.env.DB_DIALECT || 'pg').toLowerCase();
  if (dialect === 'mssql' || dialect === 'sqlserver') return 'mssql';
  if (dialect === 'mysql' || dialect === 'mysql2') return 'mysql2';
  return 'pg';
}

function buildConnectionConfig(dialect: DbDialect): KnexType.Config {
  const common = {
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'xeonb_crm',
    user: process.env.DB_USER || (dialect === 'pg' ? 'postgres' : 'sa'),
    password: process.env.DB_PASSWORD || '',
  };

  const portDefaults: Record<DbDialect, number> = {
    pg: 5432,
    mssql: 1433,
    mysql2: 3306,
  };

  const port = parseInt(process.env.DB_PORT || String(portDefaults[dialect]));

  if (dialect === 'mssql') {
    return {
      client: 'mssql',
      connection: {
        server: common.host,
        port,
        database: common.database,
        user: common.user,
        password: common.password,
        options: {
          encrypt: process.env.DB_ENCRYPT === 'true',
          trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
        },
      },
      pool: { min: 2, max: 20 },
    };
  }

  return {
    client: dialect,
    connection: {
      host: common.host,
      port,
      database: common.database,
      user: common.user,
      password: common.password,
    },
    pool: { min: 2, max: 20 },
  };
}

const dialect = getDialect();
const knexConfig = buildConnectionConfig(dialect);
const db: KnexType = Knex(knexConfig);

export { db, dialect };

/**
 * Ensure the target database exists. For MSSQL/MySQL the DB is not auto-created
 * by the container, so we connect to the system DB first and CREATE DATABASE.
 */
async function ensureDatabaseExists(): Promise<void> {
  const dbName = process.env.DB_NAME || 'xeonb_crm';

  if (dialect === 'mssql') {
    const masterDb = Knex({
      ...buildConnectionConfig(dialect),
      connection: {
        ...(buildConnectionConfig(dialect).connection as any),
        database: 'master',
      },
    });
    try {
      const result = await masterDb.raw(
        `SELECT name FROM sys.databases WHERE name = ?`, [dbName]
      );
      const rows = Array.isArray(result) ? result : [];
      if (rows.length === 0) {
        await masterDb.raw(`CREATE DATABASE [${dbName}]`);
        console.log(`Created database "${dbName}"`);
      }
    } finally {
      await masterDb.destroy();
    }
  } else if (dialect === 'mysql2') {
    const rootDb = Knex({
      ...buildConnectionConfig(dialect),
      connection: {
        ...(buildConnectionConfig(dialect).connection as any),
        database: undefined,
      },
    });
    try {
      await rootDb.raw(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    } finally {
      await rootDb.destroy();
    }
  }
  // PostgreSQL: handled by POSTGRES_DB env var in Docker, or createdb locally
}

/**
 * Wait for the database server to become available (handles Docker startup race).
 */
async function waitForConnection(maxRetries = 10, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await db.raw('SELECT 1');
      return;
    } catch (error: any) {
      if (attempt === maxRetries) throw error;
      console.log(`Database not ready (attempt ${attempt}/${maxRetries}), retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * Seed default admin account on first run (if no users exist).
 */
async function seedDefaultAdmin(): Promise<void> {
  try {
    const hasUsers = await db('users').select('id').first();
    if (!hasUsers) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      await db('users').insert({
        username: 'admin',
        email: 'admin@example.com',
        password_hash: passwordHash,
        first_name: 'Test',
        last_name: 'Admin',
        auth_provider: 'local',
        is_active: true,
        role: 'admin',
      });
      console.log('Default admin account created (admin@example.com / admin123)');
    }
  } catch (error: any) {
    // Table may not exist yet — seeding will run after migrations
    if (error.message?.includes('does not exist') || error.message?.includes('no such table') || error.code === '42P01') {
      console.log('Users table not ready yet, admin seed will run after migrations');
    } else {
      console.error('Error seeding admin user:', error);
    }
  }
}

export async function initializeDatabase() {
  try {
    // For MSSQL/MySQL, create the DB if it doesn't exist (connects to system DB)
    await ensureDatabaseExists();

    // Wait for the target database to accept connections
    await waitForConnection();
    console.log(`Database connection established (${dialect})`);

    // Run migrations to ensure tables exist
    console.log('Running database migrations...');
    await db.migrate.latest({
      directory: path.join(__dirname, 'migrations'),
      extension: 'ts',
    });
    console.log('Migrations completed');

    // Seed default admin account if no users exist
    await seedDefaultAdmin();
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
}

export default db;
