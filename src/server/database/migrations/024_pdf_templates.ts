import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("pdf_templates", (table) => {
    table.increments("id").primary();
    table.string("template_type", 50).notNullable().unique(); // 'work_order' | 'work_request'
    table.jsonb("template_config").notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now());
    table.integer("updated_by").nullable().references("id").inTable("users").onDelete("SET NULL");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("pdf_templates");
}
