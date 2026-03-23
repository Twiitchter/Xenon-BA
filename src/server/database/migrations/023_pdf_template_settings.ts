import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const settings = [
    {
      setting_key: "pdf_template_active",
      setting_value: "true",
      setting_type: "boolean",
      category: "pdf",
      description: "Enable or disable the custom PDF template",
    },
    {
      setting_key: "pdf_template_title",
      setting_value: "Work Order",
      setting_type: "string",
      category: "pdf",
      description: "Document title shown at the top of the PDF",
    },
    {
      setting_key: "pdf_template_organisation",
      setting_value: "XeonB Maintenance Portal",
      setting_type: "string",
      category: "pdf",
      description: "Organisation name shown in the header band",
    },
    {
      setting_key: "pdf_template_header_colour",
      setting_value: "#0F3460",
      setting_type: "string",
      category: "pdf",
      description: "Header background colour (hex code)",
    },
    {
      setting_key: "pdf_template_footer",
      setting_value: "XeonB Maintenance Portal",
      setting_type: "string",
      category: "pdf",
      description: "Footer text shown at the bottom of each page",
    },
    {
      setting_key: "pdf_template_extra_section_title",
      setting_value: "",
      setting_type: "string",
      category: "pdf",
      description:
        "Title for an extra custom section appended to every work order PDF",
    },
    {
      setting_key: "pdf_template_extra_section_content",
      setting_value: "",
      setting_type: "string",
      category: "pdf",
      description:
        "Content for the extra custom section (leave blank to omit)",
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
      "pdf_template_active",
      "pdf_template_title",
      "pdf_template_organisation",
      "pdf_template_header_colour",
      "pdf_template_footer",
      "pdf_template_extra_section_title",
      "pdf_template_extra_section_content",
    ])
    .delete();
}
