import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn("work_orders", "work_group");
  if (!hasColumn) {
    await knex.schema.alterTable("work_orders", (table) => {
      table.string("work_group", 255).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn("work_orders", "work_group");
  if (hasColumn) {
    await knex.schema.alterTable("work_orders", (table) => {
      table.dropColumn("work_group");
    });
  }
}
