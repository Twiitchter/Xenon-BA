import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    "failed_work_requests",
    "assetic_error_response",
  );
  if (!hasColumn) {
    await knex.schema.alterTable("failed_work_requests", (table) => {
      // Raw JSON response body returned by Assetic on failure
      table.text("assetic_error_response").nullable().after("error_message");
      // HTTP status code Assetic returned
      table
        .integer("assetic_http_status")
        .nullable()
        .after("assetic_error_response");
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    "failed_work_requests",
    "assetic_error_response",
  );
  if (hasColumn) {
    await knex.schema.alterTable("failed_work_requests", (table) => {
      table.dropColumn("assetic_error_response");
      table.dropColumn("assetic_http_status");
    });
  }
}
