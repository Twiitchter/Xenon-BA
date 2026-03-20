import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // 1. Add Assetic sync fields to work_orders
  const hasAssetic = await knex.schema.hasColumn(
    "work_orders",
    "assetic_friendly_id",
  );
  if (!hasAssetic) {
    await knex.schema.alterTable("work_orders", (table) => {
      table.string("assetic_friendly_id", 50).nullable(); // e.g. "WO42"
      table.dateTime("scheduled_finish").nullable(); // Assetic ScheduledFinish
    });
  }

  // 2. Create failed_work_orders table to capture Assetic submission failures
  const exists = await knex.schema.hasTable("failed_work_orders");
  if (!exists) {
    await knex.schema.createTable("failed_work_orders", (table) => {
      table.increments("id").primary();

      // Link back to the maintenance_request that triggered this WO attempt
      table
        .integer("request_id")
        .nullable()
        .references("id")
        .inTable("maintenance_requests")
        .onDelete("SET NULL");

      // Who triggered the attempt
      table
        .integer("created_by")
        .nullable()
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");

      // Core WO fields (editable before retry)
      table.string("title", 255).notNullable();
      table.text("description").nullable();
      table.string("priority", 50).nullable().defaultTo("medium");
      table.string("craft", 255).nullable();
      table.string("work_group", 255).nullable();
      table.string("assetic_asset_guid", 40).nullable();
      table.string("asset_name", 500).nullable();
      table.string("asset_location", 500).nullable();
      table.dateTime("scheduled_start").nullable();
      table.dateTime("scheduled_finish").nullable();

      // The full JSON payload that was sent to Assetic
      table.text("assetic_payload").nullable();

      // Error info
      table.text("error_message").nullable();
      table.text("assetic_error_response").nullable();
      table.integer("assetic_http_status").nullable();

      // Admin notes
      table.text("admin_notes").nullable();

      // Retry tracking
      table.integer("retry_count").notNullable().defaultTo(0);
      table.dateTime("last_retry_at").nullable();

      // Status: pending | resolved | dismissed
      table.string("status", 50).notNullable().defaultTo("pending");

      // If a retry succeeds, link to the resulting work_order (no cascade — MSSQL
      // rejects SET NULL when multiple cascade paths exist on the same table)
      table
        .integer("resolved_work_order_id")
        .nullable()
        .references("id")
        .inTable("work_orders")
        .onDelete("NO ACTION");

      table.dateTime("created_at").notNullable().defaultTo(knex.fn.now());
      table.dateTime("updated_at").notNullable().defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("failed_work_orders");

  const hasAssetic = await knex.schema.hasColumn(
    "work_orders",
    "assetic_friendly_id",
  );
  if (hasAssetic) {
    await knex.schema.alterTable("work_orders", (table) => {
      table.dropColumn("assetic_friendly_id");
      table.dropColumn("scheduled_finish");
    });
  }
}
