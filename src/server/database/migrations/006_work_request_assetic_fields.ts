import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add Assetic-specific required fields to maintenance_requests
  await knex.schema.alterTable('maintenance_requests', (table) => {
    // WorkRequestSourceId - REQUIRED by Assetic API
    table.string('work_request_source_id', 255).nullable();
    
    // Requestor details - REQUIRED by Assetic API
    table.string('requestor_display_name', 255).nullable();
    table.string('requestor_first_name', 255).nullable();
    table.string('requestor_surname', 255).nullable();
    table.string('requestor_email', 255).nullable();
    table.string('requestor_phone', 100).nullable();
    table.string('requestor_mobile', 100).nullable();
    table.string('requestor_type_id', 50).nullable(); // Assetic requestor type ID
    
    // Optional but important Assetic fields
    table.string('work_request_subtype_id', 255).nullable(); // Request type/subtype
    table.string('work_request_priority_id', 50).nullable(); // Assetic priority ID
    table.string('external_identifier', 255).nullable(); // External reference
    table.text('supporting_information').nullable(); // Additional notes
    
    // Physical location details (structured)
    table.string('street_number', 100).nullable();
    table.string('street_address', 255).nullable();
    table.string('city_suburb', 255).nullable();
    table.string('state', 100).nullable();
    table.string('zip_postcode', 50).nullable();
    table.string('country', 100).nullable();
    table.string('other_location', 255).nullable();
    table.string('where_location', 255).nullable();
    
    // Spatial location (if GPS coordinates available)
    table.string('spatial_location', 500).nullable(); // e.g., "POINT (144.9651119 -37.8162149)"
    
    // Reactive inspection details
    table.string('reactive_inspector_name', 255).nullable();
    table.timestamp('reactive_inspection_date').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('maintenance_requests', (table) => {
    table.dropColumn('work_request_source_id');
    table.dropColumn('requestor_display_name');
    table.dropColumn('requestor_first_name');
    table.dropColumn('requestor_surname');
    table.dropColumn('requestor_email');
    table.dropColumn('requestor_phone');
    table.dropColumn('requestor_mobile');
    table.dropColumn('requestor_type_id');
    table.dropColumn('work_request_subtype_id');
    table.dropColumn('work_request_priority_id');
    table.dropColumn('external_identifier');
    table.dropColumn('supporting_information');
    table.dropColumn('street_number');
    table.dropColumn('street_address');
    table.dropColumn('city_suburb');
    table.dropColumn('state');
    table.dropColumn('zip_postcode');
    table.dropColumn('country');
    table.dropColumn('other_location');
    table.dropColumn('where_location');
    table.dropColumn('spatial_location');
    table.dropColumn('reactive_inspector_name');
    table.dropColumn('reactive_inspection_date');
  });
}
