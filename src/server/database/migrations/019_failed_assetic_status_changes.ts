import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("failed_assetic_status_changes");
  if (!exists) {
    await knex.schema.createTable("failed_assetic_status_changes", (table) => {
      table.increments("id").primary();

      // The local work order record that was successfully created before this
      // status-change attempt failed
      table
        .integer("work_order_id")
        .nullable()
        .references("id")
        .inTable("work_orders")
        .onDelete("SET NULL");

      // Assetic GUID of the work order (stored separately in case the FK is nulled)
      table.string("assetic_work_order_guid", 40).nullable();

      // The transition that was attempted
      table.string("from_status", 20).notNullable().defaultTo("PREP");
      table.string("to_status", 20).notNullable().defaultTo("RFE");

      // Full JSON that was PUT to Assetic /workorder/{guid}
      table.text("assetic_payload").nullable();

      // Error info captured from the failed call
      table.text("error_message").nullable();
      table.text("assetic_error_response").nullable();
      table.integer("assetic_http_status").nullable();

      // Admin notes (for manual review / resolution)
      table.text("admin_notes").nullable();

      // Retry tracking
      table.integer("retry_count").notNullable().defaultTo(0);
      table.dateTime("last_retry_at").nullable();

      // Status: pending | resolved | dismissed
      table.string("status", 50).notNullable().defaultTo("pending");

      table.dateTime("created_at").notNullable().defaultTo(knex.fn.now());
      table.dateTime("updated_at").notNullable().defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("failed_assetic_status_changes");
}
