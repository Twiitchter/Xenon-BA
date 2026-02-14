import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Users table
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('username', 255).unique().notNullable();
    table.string('email', 255).unique().notNullable();
    table.string('password_hash', 255).nullable();
    table.string('first_name', 255).nullable();
    table.string('last_name', 255).nullable();
    table.string('auth_provider', 50).defaultTo('local');
    table.string('external_id', 255).nullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('email', 'idx_users_email');
    table.index('username', 'idx_users_username');
  });

  // Assets table
  await knex.schema.createTable('assets', (table) => {
    table.increments('id').primary();
    table.string('assetic_id', 255).unique().notNullable();
    table.string('asset_tag', 255).nullable();
    table.text('description').nullable();
    table.string('category', 255).nullable();
    table.string('location', 255).nullable();
    table.string('status', 100).nullable();
    table.date('purchase_date').nullable();
    table.decimal('purchase_cost', 10, 2).nullable();
    table.decimal('current_value', 10, 2).nullable();
    table.text('data').nullable(); // JSON stored as text for cross-DB compat
    table.timestamp('last_synced_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('assetic_id', 'idx_assets_assetic_id');
    table.index('status', 'idx_assets_status');
  });

  // Asset changes
  await knex.schema.createTable('asset_changes', (table) => {
    table.increments('id').primary();
    table.integer('asset_id').unsigned().references('id').inTable('assets').onDelete('CASCADE');
    table.string('change_type', 50).notNullable();
    table.string('field_name', 255).nullable();
    table.text('old_value').nullable();
    table.text('new_value').nullable();
    table.string('changed_by', 255).nullable();
    table.timestamp('changed_at').notNullable();
    table.timestamp('synced_at').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('asset_id', 'idx_asset_changes_asset_id');
    table.index('changed_at', 'idx_asset_changes_changed_at');
  });

  // Email logs
  await knex.schema.createTable('email_logs', (table) => {
    table.increments('id').primary();
    table.string('recipient', 255).notNullable();
    table.string('subject', 500).notNullable();
    table.text('body').nullable();
    table.boolean('has_attachment').defaultTo(false);
    table.string('attachment_name', 255).nullable();
    table.string('status', 50).notNullable();
    table.text('error_message').nullable();
    table.timestamp('sent_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Report logs
  await knex.schema.createTable('report_logs', (table) => {
    table.increments('id').primary();
    table.string('report_type', 100).notNullable();
    table.integer('generated_by').unsigned().nullable().references('id').inTable('users');
    table.string('file_name', 255).nullable();
    table.text('parameters').nullable(); // JSON stored as text
    table.string('status', 50).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Maintenance requests
  await knex.schema.createTable('maintenance_requests', (table) => {
    table.increments('id').primary();
    table.integer('asset_id').unsigned().nullable().references('id').inTable('assets').onDelete('SET NULL');
    table.integer('requested_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    table.string('title', 255).notNullable();
    table.text('description').nullable();
    table.string('priority', 50).defaultTo('medium');
    table.string('status', 50).defaultTo('open');
    table.string('category', 255).nullable();
    table.string('location', 255).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('status', 'idx_maintenance_requests_status');
    table.index('requested_by', 'idx_maintenance_requests_requested_by');
  });

  // Work orders
  await knex.schema.createTable('work_orders', (table) => {
    table.increments('id').primary();
    table.integer('request_id').unsigned().references('id').inTable('maintenance_requests').onDelete('CASCADE');
    table.integer('assigned_to').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    table.string('craft', 255).nullable();
    table.string('title', 255).notNullable();
    table.text('description').nullable();
    table.string('priority', 50).defaultTo('medium');
    table.string('status', 50).defaultTo('pending');
    table.date('scheduled_date').nullable();
    table.timestamp('completed_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('status', 'idx_work_orders_status');
    table.index('request_id', 'idx_work_orders_request_id');
    table.index('assigned_to', 'idx_work_orders_assigned_to');
  });

  // Work order messages
  await knex.schema.createTable('work_order_messages', (table) => {
    table.increments('id').primary();
    table.integer('work_order_id').unsigned().references('id').inTable('work_orders').onDelete('CASCADE');
    table.integer('sender_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    table.text('message').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('work_order_id', 'idx_work_order_messages_work_order_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('work_order_messages');
  await knex.schema.dropTableIfExists('work_orders');
  await knex.schema.dropTableIfExists('maintenance_requests');
  await knex.schema.dropTableIfExists('report_logs');
  await knex.schema.dropTableIfExists('email_logs');
  await knex.schema.dropTableIfExists('asset_changes');
  await knex.schema.dropTableIfExists('assets');
  await knex.schema.dropTableIfExists('users');
}
