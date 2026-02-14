import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add the assetic_api_username setting required for Basic auth
  const exists = await knex('system_settings')
    .where('setting_key', 'assetic_api_username')
    .first();

  if (!exists) {
    await knex('system_settings').insert({
      setting_key: 'assetic_api_username',
      setting_value: '',
      setting_type: 'string',
      category: 'assetic',
      description: 'Assetic API username',
    });
  }

  // Fix description for api_url to make clear it should be the site root
  await knex('system_settings')
    .where('setting_key', 'assetic_api_url')
    .update({
      description: 'Assetic site URL (e.g. https://yoursite.assetic.net)',
    });

  // Default version should be v2 per Assetic API docs
  await knex('system_settings')
    .where('setting_key', 'assetic_api_version')
    .where('setting_value', 'v1')
    .update({ setting_value: 'v2' });
}

export async function down(knex: Knex): Promise<void> {
  await knex('system_settings')
    .where('setting_key', 'assetic_api_username')
    .del();

  await knex('system_settings')
    .where('setting_key', 'assetic_api_url')
    .update({ description: 'Assetic API base URL' });

  await knex('system_settings')
    .where('setting_key', 'assetic_api_version')
    .update({ setting_value: 'v1' });
}
