import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable("work_request_attachments");
  if (!hasTable) {
    await knex.schema.createTable("work_request_attachments", (table) => {
      table.increments("id").primary();
      table
        .integer("maintenance_request_id")
        .notNullable()
        .references("id")
        .inTable("maintenance_requests")
        .onDelete("CASCADE");
      table.string("original_filename", 255).notNullable();
      table.string("mime_type", 100);
      table.integer("file_size"); // bytes
      table.string("assetic_document_id", 100); // GUID returned by Assetic
      table
        .string("assetic_upload_status", 50)
        .notNullable()
        .defaultTo("pending"); // pending | uploaded | failed
      table.text("error_message");
      table.integer("uploaded_by").references("id").inTable("users");
      table.timestamp("created_at").defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("work_request_attachments");
}
