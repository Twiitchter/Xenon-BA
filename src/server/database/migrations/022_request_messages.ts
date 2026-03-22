import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Add is_staff to work_order_messages so staff/reporter bubbles can be styled differently
  const hasIsStaff = await knex.schema.hasColumn(
    "work_order_messages",
    "is_staff",
  );
  if (!hasIsStaff) {
    await knex.schema.alterTable("work_order_messages", (table) => {
      table.boolean("is_staff").notNullable().defaultTo(false);
    });
  }

  // Add unread flags to work_orders (reporter = the person who submitted the request)
  const woHasUnread = await knex.schema.hasColumn(
    "work_orders",
    "unread_reporter",
  );
  if (!woHasUnread) {
    await knex.schema.alterTable("work_orders", (table) => {
      table.boolean("unread_reporter").notNullable().defaultTo(false);
      table.boolean("unread_staff").notNullable().defaultTo(false);
    });
  }

  // Create request_messages for request-level messaging (before a WO is created)
  const hasTable = await knex.schema.hasTable("request_messages");
  if (!hasTable) {
    await knex.schema.createTable("request_messages", (table) => {
      table.increments("id").primary();
      table
        .integer("request_id")
        .notNullable()
        .references("id")
        .inTable("maintenance_requests")
        .onDelete("CASCADE");
      table
        .integer("sender_id")
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");
      table.text("message").notNullable();
      table.boolean("is_staff").notNullable().defaultTo(false);
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.index("request_id", "idx_request_messages_request_id");
    });
  }

  // Add unread flags to maintenance_requests
  const hasUnread = await knex.schema.hasColumn(
    "maintenance_requests",
    "unread_reporter",
  );
  if (!hasUnread) {
    await knex.schema.alterTable("maintenance_requests", (table) => {
      table.boolean("unread_reporter").notNullable().defaultTo(false);
      table.boolean("unread_staff").notNullable().defaultTo(false);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("request_messages");

  const woHasUnread = await knex.schema.hasColumn(
    "work_orders",
    "unread_reporter",
  );
  if (woHasUnread) {
    await knex.schema.alterTable("work_orders", (table) => {
      table.dropColumn("unread_reporter");
      table.dropColumn("unread_staff");
    });
  }

  const hasUnread = await knex.schema.hasColumn(
    "maintenance_requests",
    "unread_reporter",
  );
  if (hasUnread) {
    await knex.schema.alterTable("maintenance_requests", (table) => {
      table.dropColumn("unread_reporter");
      table.dropColumn("unread_staff");
    });
  }
}
