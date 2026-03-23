import { Knex } from "knex";

/**
 * Add assetic_resource_id to users table.
 *
 * Caches the Assetic resource record ID for each user so that the
 * GET /resource?ExternalId=<userId> look-up only needs to happen once
 * (on first login or first work-request submission) rather than on every
 * work-request creation.
 *
 * A non-null value means the user's Assetic resource has been provisioned
 * and no further API round-trips are needed to ensure the resource exists.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.string("assetic_resource_id", 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("assetic_resource_id");
  });
}
