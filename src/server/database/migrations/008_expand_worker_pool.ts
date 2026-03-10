import { Knex } from "knex";

/**
 * Expand the Assetic worker pool from 2 to 10 workers.
 *
 * Migration 004 seeded credentials for workers 1–2.
 * This migration adds credential placeholders for workers 3–10
 * and updates the worker_count description to reflect the new max.
 */
export async function up(knex: Knex): Promise<void> {
  // Update worker_count description to reflect new max
  await knex("system_settings")
    .where("setting_key", "assetic_worker_count")
    .update({
      description:
        "Number of API agent workers (each gets 250 req/min). Range 1–10.",
    });

  // Seed per-worker credential placeholders for workers 3–10
  for (let n = 3; n <= 10; n++) {
    const uKey = `assetic_worker_${n}_username`;
    const kKey = `assetic_worker_${n}_api_key`;

    const existsU = await knex("system_settings")
      .where("setting_key", uKey)
      .first();
    if (!existsU) {
      await knex("system_settings").insert({
        setting_key: uKey,
        setting_value: "",
        setting_type: "string",
        category: "assetic",
        description: `API username for worker ${n} (leave blank to use default)`,
      });
    }

    const existsK = await knex("system_settings")
      .where("setting_key", kKey)
      .first();
    if (!existsK) {
      await knex("system_settings").insert({
        setting_key: kKey,
        setting_value: "",
        setting_type: "string",
        category: "assetic",
        description: `API key for worker ${n} (leave blank to use default)`,
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  for (let n = 3; n <= 10; n++) {
    await knex("system_settings")
      .where("setting_key", `assetic_worker_${n}_username`)
      .del();
    await knex("system_settings")
      .where("setting_key", `assetic_worker_${n}_api_key`)
      .del();
  }

  await knex("system_settings")
    .where("setting_key", "assetic_worker_count")
    .update({
      description:
        "Number of API agent workers (each gets 250 req/min). Min 1.",
    });
}
