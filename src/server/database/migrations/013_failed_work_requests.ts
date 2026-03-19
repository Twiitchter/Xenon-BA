import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("failed_work_requests");
  if (!exists) {
    await knex.schema.createTable("failed_work_requests", (table) => {
      table.increments("id").primary();

      // Who submitted it
      table
        .integer("requested_by")
        .nullable()
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");

      // Core request fields (editable before retry)
      table.string("title", 255).notNullable();
      table.text("description").nullable();
      table.string("priority", 50).nullable().defaultTo("medium");
      table.string("category", 255).nullable();
      table.string("location", 500).nullable();
      table.string("assetic_asset_guid", 40).nullable();
      table.string("work_request_source_id", 50).nullable();

      // Requestor fields
      table.string("requestor_display_name", 500).nullable();
      table.string("requestor_first_name", 255).nullable();
      table.string("requestor_surname", 255).nullable();
      table.string("requestor_email", 255).nullable();
      table.string("requestor_phone", 100).nullable();
      table.string("requestor_mobile", 100).nullable();
      table.text("supporting_information").nullable();
      table.string("external_identifier", 255).nullable();

      // The full JSON payload that was sent to Assetic (or would have been)
      table.text("assetic_payload").nullable();

      // The error returned by Assetic
      table.text("error_message").nullable();

      // Admin notes / comments
      table.text("admin_notes").nullable();

      // Retry tracking
      table.integer("retry_count").notNullable().defaultTo(0);
      table.dateTime("last_retry_at").nullable();

      // Status: pending | resolved | dismissed
      table.string("status", 50).notNullable().defaultTo("pending");

      // If a retry succeeds, link to the resulting maintenance_request
      table
        .integer("resolved_request_id")
        .nullable()
        .references("id")
        .inTable("maintenance_requests")
        .onDelete("SET NULL");

      table.dateTime("created_at").notNullable().defaultTo(knex.fn.now());
      table.dateTime("updated_at").notNullable().defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("failed_work_requests");
}
