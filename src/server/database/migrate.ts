import fs from 'fs';
import path from 'path';
import { getClient } from './index';

async function migrate() {
  const client = await getClient();
  
  try {
    console.log('Starting database migration...');
    
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    await client.query('BEGIN');
    await client.query(schema);
    await client.query('COMMIT');
    
    console.log('Migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default migrate;
