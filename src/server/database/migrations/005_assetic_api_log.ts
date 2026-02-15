import { Knex } from 'knex';

/**
 * Add the assetic_api_log table for tracking all Assetic API calls,
 * with a focus on work request operations for debugging.
 *
 * Stores: endpoint, HTTP method/status, request & response bodies,
 * duration, worker ID, calling user, and error details.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('assetic_api_log', (table) => {
    table.increments('id').primary();

    // What was called
    table.string('method', 10).notNullable();             // GET | POST | PUT | DELETE
    table.string('endpoint', 500).notNullable();           // e.g. /workrequest
    table.string('description', 255).nullable();           // human-readable label from asseticClient

    // Categorisation
    table.string('entity_type', 50).notNullable();         // work_request | work_order | asset | auth | other
    table.string('entity_guid', 255).nullable();           // Assetic GUID of the entity (if known)

    // Request / response payloads (stored as JSON text)
    table.text('request_body').nullable();
    table.text('response_body').nullable();
    table.integer('http_status').nullable();                // 200, 201, 400, 500, etc.
    table.text('error_message').nullable();                 // on failure

    // Timing
    table.integer('duration_ms').nullable();                // round-trip time in ms

    // Context
    table.integer('worker_id').nullable();                  // which pool worker handled this
    table.integer('performed_by').unsigned().nullable()     // XeonB user who triggered the call
      .references('id').inTable('users').onDelete('SET NULL');
    table.string('source', 100).nullable();                // route or service that initiated the call

    // Outcome
    table.string('status', 20).notNullable().defaultTo('success'); // success | error | timeout

    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Indexes for common queries
    table.index('entity_type', 'idx_api_log_entity_type');
    table.index('entity_guid', 'idx_api_log_entity_guid');
    table.index('http_status', 'idx_api_log_http_status');
    table.index('status', 'idx_api_log_status');
    table.index('created_at', 'idx_api_log_created_at');
    table.index('performed_by', 'idx_api_log_performed_by');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('assetic_api_log');
}
