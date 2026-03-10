import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Full asset cache — stores every asset pulled from Assetic
  await knex.schema.createTable("assetic_assets", (table) => {
    table.increments("id").primary();
    table
      .string("assetic_guid", 40)
      .unique()
      .notNullable()
      .comment("Assetic internal GUID (Id field)");
    table
      .string("asset_id", 255)
      .nullable()
      .comment("Human-readable Assetic AssetId");
    table.string("asset_name", 500).nullable();
    table.string("asset_status", 100).nullable();
    table.string("asset_type", 255).nullable();
    table.string("asset_class", 255).nullable();
    table.string("asset_category", 255).nullable();
    table.text("data").nullable().comment("Full JSON payload from Assetic");
    table.timestamp("synced_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index("asset_id", "idx_assetic_assets_asset_id");
    table.index("asset_status", "idx_assetic_assets_status");
    table.index("synced_at", "idx_assetic_assets_synced_at");
  });

  // Per-asset functional location relationship
  // Populated by calling GET /assets/{guid}/functionallocation for each asset
  await knex.schema.createTable(
    "assetic_asset_functional_locations",
    (table) => {
      table.increments("id").primary();
      table
        .string("asset_guid", 40)
        .notNullable()
        .comment("FK to assetic_assets.assetic_guid");
      table
        .string("fl_guid", 40)
        .nullable()
        .comment("Functional Location GUID");
      table.string("fl_id", 255).nullable().comment("FunctionalLocationId");
      table.string("fl_name", 500).nullable().comment("FunctionalLocationName");
      table
        .string("fl_type", 255)
        .nullable()
        .comment("FunctionalLocationType (Region/Site/Building/Floor)");
      table.string("fl_type_id", 40).nullable();
      table
        .string("parent_fl_guid", 40)
        .nullable()
        .comment("Parent FL GUID if available");
      table
        .text("fl_data")
        .nullable()
        .comment("Full JSON payload from FL endpoint");
      table.timestamp("synced_at").notNullable().defaultTo(knex.fn.now());

      table.index("asset_guid", "idx_aafl_asset_guid");
      table.index("fl_guid", "idx_aafl_fl_guid");
      table.index("fl_type", "idx_aafl_fl_type");
      table.unique(["asset_guid"], "uq_aafl_asset_guid");
    },
  );

  // Standalone FL table — stores all functional locations with parent chain
  await knex.schema.createTable("assetic_functional_locations", (table) => {
    table.increments("id").primary();
    table.string("fl_guid", 40).unique().notNullable();
    table.string("fl_id", 255).nullable();
    table.string("fl_name", 500).nullable();
    table.string("fl_type", 255).nullable();
    table.string("fl_type_id", 40).nullable();
    table
      .string("parent_fl_guid", 40)
      .nullable()
      .comment(
        "Parent FL GUID — discovered via child-FL endpoint or name matching",
      );
    table.text("fl_data").nullable();
    table.timestamp("synced_at").notNullable().defaultTo(knex.fn.now());

    table.index("fl_type", "idx_afl_fl_type");
    table.index("parent_fl_guid", "idx_afl_parent");
  });

  // Sync metadata — tracks sync runs
  await knex.schema.createTable("assetic_sync_log", (table) => {
    table.increments("id").primary();
    table
      .string("sync_type", 50)
      .notNullable()
      .comment("assets | functional_locations | fl_enrichment");
    table.string("status", 50).notNullable().defaultTo("running");
    table.integer("total_count").nullable();
    table.integer("synced_count").nullable().defaultTo(0);
    table.integer("error_count").nullable().defaultTo(0);
    table.text("error_message").nullable();
    table.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("completed_at").nullable();

    table.index("sync_type", "idx_sync_log_type");
    table.index("started_at", "idx_sync_log_started");
  });

  // Add sync settings
  const exists = await knex("system_settings")
    .where("setting_key", "assetic_asset_sync_enabled")
    .first();
  if (!exists) {
    await knex("system_settings").insert([
      {
        setting_key: "assetic_asset_sync_enabled",
        setting_value: "true",
        setting_type: "boolean",
        category: "assetic",
        description:
          "Enable automatic hourly asset sync from Assetic API into the local database",
      },
      {
        setting_key: "assetic_sync_interval_minutes",
        setting_value: "60",
        setting_type: "number",
        category: "assetic",
        description:
          "Minutes between automatic sync checks (compares API count vs DB count)",
      },
      {
        setting_key: "assetic_fl_enrichment_enabled",
        setting_value: "true",
        setting_type: "boolean",
        category: "assetic",
        description:
          "After asset sync, fetch functional location for each asset to build hierarchy",
      },
    ]);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("assetic_sync_log");
  await knex.schema.dropTableIfExists("assetic_asset_functional_locations");
  await knex.schema.dropTableIfExists("assetic_functional_locations");
  await knex.schema.dropTableIfExists("assetic_assets");
  await knex("system_settings")
    .whereIn("setting_key", [
      "assetic_asset_sync_enabled",
      "assetic_sync_interval_minutes",
      "assetic_fl_enrichment_enabled",
    ])
    .del();
}
