import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("contractors");
  if (!exists) {
    await knex.schema.createTable("contractors", (table) => {
      table.increments("id").primary();
      table.string("name").notNullable();
      table.string("email").notNullable();
      table.string("phone").nullable();
      table.string("company").nullable();
      // Array of trade names this contractor handles, e.g. ["Carpenter","Painter"]
      // Empty array = catch-all (matches any craft)
      table.jsonb("trades").notNullable().defaultTo("[]");
      table.boolean("receives_work_orders").notNullable().defaultTo(false);
      table.boolean("is_active").notNullable().defaultTo(true);
      // Optional per-contractor email template with {{variable}} placeholders
      table.text("email_template").nullable();
      table.text("notes").nullable();
      table.timestamps(true, true);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("contractors");
}
