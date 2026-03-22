import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const settings = [
    {
      setting_key: "email_provider",
      setting_value: "smtp",
      setting_type: "string",
      category: "email",
      description: "Email provider: smtp or api",
    },
    {
      setting_key: "email_smtp_host",
      setting_value: "",
      setting_type: "string",
      category: "email",
      description: "SMTP server hostname",
    },
    {
      setting_key: "email_smtp_port",
      setting_value: "587",
      setting_type: "string",
      category: "email",
      description: "SMTP server port",
    },
    {
      setting_key: "email_smtp_secure",
      setting_value: "false",
      setting_type: "boolean",
      category: "email",
      description: "Use TLS/SSL for SMTP connection",
    },
    {
      setting_key: "email_smtp_user",
      setting_value: "",
      setting_type: "string",
      category: "email",
      description: "SMTP authentication username",
    },
    {
      setting_key: "email_smtp_password",
      setting_value: "",
      setting_type: "string",
      category: "email",
      description: "SMTP authentication password",
    },
    {
      setting_key: "email_from_address",
      setting_value: "",
      setting_type: "string",
      category: "email",
      description: "Default sender (From) email address",
    },
    {
      setting_key: "email_from_name",
      setting_value: "Facilities Management Portal",
      setting_type: "string",
      category: "email",
      description: "Default sender display name",
    },
    {
      setting_key: "email_api_provider",
      setting_value: "sendgrid",
      setting_type: "string",
      category: "email",
      description: "API email provider: sendgrid or mailgun",
    },
    {
      setting_key: "email_api_key",
      setting_value: "",
      setting_type: "string",
      category: "email",
      description: "API key for the selected email API provider",
    },
    {
      setting_key: "email_api_domain",
      setting_value: "",
      setting_type: "string",
      category: "email",
      description: "Domain for Mailgun (only required for Mailgun provider)",
    },
    {
      setting_key: "email_portal_url",
      setting_value: "",
      setting_type: "string",
      category: "email",
      description:
        "Public URL of the portal (used in email links, e.g. https://portal.example.com)",
    },
  ];

  for (const setting of settings) {
    const exists = await knex("system_settings")
      .where("setting_key", setting.setting_key)
      .first();
    if (!exists) {
      await knex("system_settings").insert(setting);
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex("system_settings")
    .whereIn("setting_key", [
      "email_provider",
      "email_smtp_host",
      "email_smtp_port",
      "email_smtp_secure",
      "email_smtp_user",
      "email_smtp_password",
      "email_from_address",
      "email_from_name",
      "email_api_provider",
      "email_api_key",
      "email_api_domain",
      "email_portal_url",
    ])
    .delete();
}
