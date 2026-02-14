import path from 'path';
import db, { dialect } from './index';

async function migrate() {
  try {
    console.log(`Starting database migration (${dialect})...`);

    await db.migrate.latest({
      directory: path.join(__dirname, 'migrations'),
      extension: 'ts',
    });

    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
}

async function rollback() {
  try {
    console.log(`Rolling back migration (${dialect})...`);

    await db.migrate.rollback({
      directory: path.join(__dirname, 'migrations'),
      extension: 'ts',
    });

    console.log('Rollback completed successfully');
  } catch (error) {
    console.error('Rollback failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  const command = process.argv[2];

  if (command === 'rollback') {
    rollback()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    migrate()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  }
}

export default migrate;
