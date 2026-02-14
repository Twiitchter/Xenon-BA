import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add role column to users table
  await knex.schema.alterTable('users', (table) => {
    table.string('role', 50).defaultTo('user'); // admin | manager | user
    table.string('phone', 50).nullable();
    table.string('department', 255).nullable();
  });

  // System settings table — stores key/value config including Assetic API keys
  await knex.schema.createTable('system_settings', (table) => {
    table.increments('id').primary();
    table.string('setting_key', 255).unique().notNullable();
    table.text('setting_value').nullable();
    table.string('setting_type', 50).defaultTo('string'); // string | boolean | number | json
    table.string('category', 100).defaultTo('general'); // general | assetic | sso | email | ui
    table.text('description').nullable();
    table.integer('updated_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('setting_key', 'idx_settings_key');
    table.index('category', 'idx_settings_category');
  });

  // Add reference number + more lifecycle fields to maintenance_requests
  await knex.schema.alterTable('maintenance_requests', (table) => {
    table.string('reference_number', 50).nullable();
    table.string('contact_name', 255).nullable();
    table.string('contact_phone', 100).nullable();
    table.string('contact_email', 255).nullable();
    table.string('building', 255).nullable();
    table.string('floor', 100).nullable();
    table.string('room', 100).nullable();
    table.text('resolution_notes').nullable();
    table.timestamp('resolved_at').nullable();
    table.string('assetic_work_request_id', 255).nullable(); // linked Assetic work request
  });

  // Add Assetic sync fields to work_orders
  await knex.schema.alterTable('work_orders', (table) => {
    table.string('assetic_work_order_id', 255).nullable(); // linked Assetic work order
    table.text('resolution_notes').nullable();
    table.decimal('estimated_cost', 12, 2).nullable();
    table.decimal('actual_cost', 12, 2).nullable();
    table.string('asset_name', 255).nullable();
    table.string('asset_location', 255).nullable();
  });

  // Activity log for full lifecycle audit trail
  await knex.schema.createTable('activity_log', (table) => {
    table.increments('id').primary();
    table.string('entity_type', 50).notNullable(); // request | work_order | user | setting
    table.integer('entity_id').unsigned().notNullable();
    table.string('action', 100).notNullable(); // created | updated | status_changed | assigned | commented | synced
    table.text('details').nullable(); // JSON with before/after or context
    table.integer('performed_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('entity_type', 'idx_activity_entity_type');
    table.index('entity_id', 'idx_activity_entity_id');
    table.index('created_at', 'idx_activity_created_at');
  });

  // Seed default system settings
  const defaults = [
    { setting_key: 'app_name', setting_value: 'Facilities Management Portal', setting_type: 'string', category: 'general', description: 'Application display name' },
    { setting_key: 'assetic_api_url', setting_value: '', setting_type: 'string', category: 'assetic', description: 'Assetic site URL (e.g. https://yoursite.assetic.net)' },
    { setting_key: 'assetic_api_key', setting_value: '', setting_type: 'string', category: 'assetic', description: 'Assetic API key/token' },
    { setting_key: 'assetic_api_version', setting_value: 'v2', setting_type: 'string', category: 'assetic', description: 'Assetic API version' },
    { setting_key: 'assetic_sync_enabled', setting_value: 'false', setting_type: 'boolean', category: 'assetic', description: 'Enable automatic sync with Assetic' },
    { setting_key: 'sso_enabled', setting_value: 'false', setting_type: 'boolean', category: 'sso', description: 'Enable SSO authentication' },
    { setting_key: 'sso_provider', setting_value: 'oauth2', setting_type: 'string', category: 'sso', description: 'SSO provider type (oauth2 or saml)' },
    { setting_key: 'sso_client_id', setting_value: '', setting_type: 'string', category: 'sso', description: 'SSO client ID' },
    { setting_key: 'sso_client_secret', setting_value: '', setting_type: 'string', category: 'sso', description: 'SSO client secret' },
    { setting_key: 'sso_auth_url', setting_value: '', setting_type: 'string', category: 'sso', description: 'SSO authorization URL' },
    { setting_key: 'sso_token_url', setting_value: '', setting_type: 'string', category: 'sso', description: 'SSO token URL' },
    { setting_key: 'sso_callback_url', setting_value: '', setting_type: 'string', category: 'sso', description: 'SSO callback URL' },
    { setting_key: 'sso_auto_create_users', setting_value: 'true', setting_type: 'boolean', category: 'sso', description: 'Automatically create user accounts on first SSO login' },
    { setting_key: 'sso_default_role', setting_value: 'user', setting_type: 'string', category: 'sso', description: 'Default role for SSO-created users' },
    { setting_key: 'email_notifications_enabled', setting_value: 'false', setting_type: 'boolean', category: 'email', description: 'Enable email notifications' },
    { setting_key: 'auto_generate_reference', setting_value: 'true', setting_type: 'boolean', category: 'general', description: 'Auto-generate reference numbers for requests' },
    { setting_key: 'default_priority', setting_value: 'medium', setting_type: 'string', category: 'general', description: 'Default priority for new requests' },
  ];

  for (const setting of defaults) {
    // Use a raw upsert approach that works on all backends
    const exists = await knex('system_settings').where('setting_key', setting.setting_key).first();
    if (!exists) {
      await knex('system_settings').insert(setting);
    }
  }

  // Set default admin role on existing admin account
  await knex('users').where('email', 'admin@example.com').update({ role: 'admin' });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('activity_log');
  await knex.schema.dropTableIfExists('system_settings');

  await knex.schema.alterTable('work_orders', (table) => {
    table.dropColumn('assetic_work_order_id');
    table.dropColumn('resolution_notes');
    table.dropColumn('estimated_cost');
    table.dropColumn('actual_cost');
    table.dropColumn('asset_name');
    table.dropColumn('asset_location');
  });

  await knex.schema.alterTable('maintenance_requests', (table) => {
    table.dropColumn('reference_number');
    table.dropColumn('contact_name');
    table.dropColumn('contact_phone');
    table.dropColumn('contact_email');
    table.dropColumn('building');
    table.dropColumn('floor');
    table.dropColumn('room');
    table.dropColumn('resolution_notes');
    table.dropColumn('resolved_at');
    table.dropColumn('assetic_work_request_id');
  });

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('role');
    table.dropColumn('phone');
    table.dropColumn('department');
  });
}
