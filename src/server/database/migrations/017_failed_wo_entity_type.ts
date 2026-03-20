import { Knex } from "knex";

/**
 * Adds entity_type and entity_id columns to failed_work_requests so that
 * the table can represent failures for both work requests and work orders.
 */
export async function up(knex: Knex): Promise<void> {
  const hasEntityType = await knex.schema.hasColumn(
    "failed_work_requests",
    "entity_type",
  );
  if (!hasEntityType) {
    await knex.schema.alterTable("failed_work_requests", (table) => {
      // 'work_request' | 'work_order'
      table.string("entity_type", 50).nullable().defaultTo("work_request");
      table.integer("entity_id").nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasEntityType = await knex.schema.hasColumn(
    "failed_work_requests",
    "entity_type",
  );
  if (hasEntityType) {
    await knex.schema.alterTable("failed_work_requests", (table) => {
      table.dropColumn("entity_type");
      table.dropColumn("entity_id");
    });
  }
}
