import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    "maintenance_requests",
    "assetic_friendly_id",
  );
  if (!hasColumn) {
    await knex.schema.alterTable("maintenance_requests", (table) => {
      // Human-readable Assetic WR number e.g. "WR35"
      table
        .string("assetic_friendly_id", 100)
        .nullable()
        .after("assetic_work_request_id");
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    "maintenance_requests",
    "assetic_friendly_id",
  );
  if (hasColumn) {
    await knex.schema.alterTable("maintenance_requests", (table) => {
      table.dropColumn("assetic_friendly_id");
    });
  }
}
