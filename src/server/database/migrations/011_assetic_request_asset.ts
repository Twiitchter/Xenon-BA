import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Add Assetic asset fields to maintenance_requests so the asset selected
  // during work request creation is stored and can be passed to the Assetic API.
  const hasGuid = await knex.schema.hasColumn(
    "maintenance_requests",
    "assetic_asset_guid",
  );
  if (!hasGuid) {
    await knex.schema.alterTable("maintenance_requests", (table) => {
      // The Assetic internal GUID of the selected asset (assetic_assets.assetic_guid).
      // This is passed as "AssetId" in the Assetic work request POST payload.
      table
        .string("assetic_asset_guid", 40)
        .nullable()
        .comment("Assetic asset GUID passed to /workrequest as AssetId");
      // Human-readable name stored for display without extra joins
      table
        .string("asset_display_name", 500)
        .nullable()
        .comment(
          "Friendly asset name for display (from assetic_assets.asset_name)",
        );
    });
  }

  // Add asset_id FK to work_orders so asset linkage flows through the whole lifecycle.
  // work_orders already has asset_name/asset_location (migration 002) for denormalised
  // display, but we also want the proper FK for queries.
  const hasWoAssetGuid = await knex.schema.hasColumn(
    "work_orders",
    "assetic_asset_guid",
  );
  if (!hasWoAssetGuid) {
    await knex.schema.alterTable("work_orders", (table) => {
      table
        .string("assetic_asset_guid", 40)
        .nullable()
        .comment("Copied from parent maintenance_request for asset linkage");
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasGuid = await knex.schema.hasColumn(
    "maintenance_requests",
    "assetic_asset_guid",
  );
  if (hasGuid) {
    await knex.schema.alterTable("maintenance_requests", (table) => {
      table.dropColumn("assetic_asset_guid");
      table.dropColumn("asset_display_name");
    });
  }

  const hasWoAssetGuid = await knex.schema.hasColumn(
    "work_orders",
    "assetic_asset_guid",
  );
  if (hasWoAssetGuid) {
    await knex.schema.alterTable("work_orders", (table) => {
      table.dropColumn("assetic_asset_guid");
    });
  }
}
