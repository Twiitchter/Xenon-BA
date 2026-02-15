import { Knex } from 'knex';

/**
 * Add settings for the Assetic API multi-worker pool.
 *
 * Workers let you spread API calls across multiple Assetic agent
 * accounts.  Each agent has its own 250 req/min limit, so total
 * throughput = worker_count × 250.
 *
 * Settings:
 *   assetic_worker_count         — number of workers (min 1)
 *   assetic_worker_N_username    — per-worker username
 *   assetic_worker_N_api_key     — per-worker API key
 *
 * Workers whose per-worker credentials are empty fall back to the
 * default assetic_api_username / assetic_api_key.
 */
export async function up(knex: Knex): Promise<void> {
  // Worker count (default 2 for new installs — existing single-cred
  // setups still work because workers fall back to the default creds)
  const existsCount = await knex('system_settings')
    .where('setting_key', 'assetic_worker_count')
    .first();

  if (!existsCount) {
    await knex('system_settings').insert({
      setting_key: 'assetic_worker_count',
      setting_value: '2',
      setting_type: 'number',
      category: 'assetic',
      description:
        'Number of API agent workers (each gets 250 req/min). Min 1.',
    });
  }

  // Seed per-worker credential placeholders for workers 1 and 2
  for (const n of [1, 2]) {
    const uKey = `assetic_worker_${n}_username`;
    const kKey = `assetic_worker_${n}_api_key`;

    const existsU = await knex('system_settings')
      .where('setting_key', uKey)
      .first();
    if (!existsU) {
      await knex('system_settings').insert({
        setting_key: uKey,
        setting_value: '',
        setting_type: 'string',
        category: 'assetic',
        description: `API username for worker ${n} (leave blank to use default)`,
      });
    }

    const existsK = await knex('system_settings')
      .where('setting_key', kKey)
      .first();
    if (!existsK) {
      await knex('system_settings').insert({
        setting_key: kKey,
        setting_value: '',
        setting_type: 'string',
        category: 'assetic',
        description: `API key for worker ${n} (leave blank to use default)`,
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('system_settings')
    .where('setting_key', 'assetic_worker_count')
    .del();

  for (const n of [1, 2]) {
    await knex('system_settings')
      .where('setting_key', `assetic_worker_${n}_username`)
      .del();
    await knex('system_settings')
      .where('setting_key', `assetic_worker_${n}_api_key`)
      .del();
  }
}
