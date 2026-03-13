import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    // Display name for ward/location accounts (e.g. "LGH Ward 4B")
    // Shown instead of username wherever a friendly label is needed.
    table.string("display_name", 255).nullable();

    // Preferred location — stored as FL GUIDs so they remain valid if names change.
    // The matching name columns are cached for display without extra joins.
    table.string("pref_region_id", 255).nullable();
    table.string("pref_region_name", 255).nullable();
    table.string("pref_site_id", 255).nullable();
    table.string("pref_site_name", 255).nullable();
    table.string("pref_building_id", 255).nullable();
    table.string("pref_building_name", 255).nullable();
    table.string("pref_floor_id", 255).nullable();
    table.string("pref_floor_name", 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("display_name");
    table.dropColumn("pref_region_id");
    table.dropColumn("pref_region_name");
    table.dropColumn("pref_site_id");
    table.dropColumn("pref_site_name");
    table.dropColumn("pref_building_id");
    table.dropColumn("pref_building_name");
    table.dropColumn("pref_floor_id");
    table.dropColumn("pref_floor_name");
  });
}
