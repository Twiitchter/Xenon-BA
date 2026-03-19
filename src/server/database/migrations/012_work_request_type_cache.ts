import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("assetic_work_request_types");
  if (!exists) {
    await knex.schema.createTable("assetic_work_request_types", (table) => {
      table.increments("id").primary();
      // The Assetic WorkRequestSubType Id (integer from Assetic)
      table.integer("assetic_id").notNullable();
      // Display label shown to users
      table.string("name", 500).notNullable();
      // Parent type name (e.g. "Incident", "Reactive")
      table.string("type_name", 255).nullable();
      // When this record was last fetched from Assetic
      table.dateTime("cached_at").notNullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("assetic_work_request_types");
}
