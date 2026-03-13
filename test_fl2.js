const knex = require('knex');
const db = knex({ 
  client: 'mssql', 
  connection: { 
    host: 'mssql', port: 1433, user: 'sa', 
    password: 'YourStrong!Passw0rd', 
    database: 'xeonb_crm', 
    options: { encrypt: false, trustServerCertificate: true } 
  } 
});
const axios = require('axios');

async function main() {
  const settings = await db('system_settings').whereIn('setting_key', ['assetic_api_url','assetic_api_key_1','assetic_username_1']);
  const map = Object.fromEntries(settings.map(s => [s.setting_key, s.setting_value]));
  
  const baseURL = map.assetic_api_url.replace(/\/$/, '') + '/api/v2';
  const auth = { username: map.assetic_username_1, password: map.assetic_api_key_1 };
  console.log('Calling:', baseURL, 'user:', map.assetic_username_1);
  
  const region = await db('assetic_functional_locations').where('fl_type', 'Region').first();
  console.log('Region:', region.fl_guid, region.fl_name, 'fl_id:', region.fl_id);
  
  // nested by GUID
  try {
    const r = await axios.get(`${baseURL}/functionallocations/${region.fl_guid}/functionallocations`, { auth, params: { 'requestParams.pageSize': 100 }, timeout: 15000 });
    const rows = r.data.ResourceList || r.data.Data || (Array.isArray(r.data) ? r.data : []);
    console.log('GUID nested rows:', rows.length, ' | keys:', Object.keys(r.data));
    if (rows.length) console.log('first child:', JSON.stringify(rows[0]).slice(0,400));
    else console.log('raw:', JSON.stringify(r.data).slice(0,300));
  } catch(e) { console.log('GUID err:', e.response?.status, e.message); }
  
  // nested by numeric ID
  try {
    const r2 = await axios.get(`${baseURL}/functionallocations/${region.fl_id}/functionallocations`, { auth, params: { 'requestParams.pageSize': 100 }, timeout: 15000 });
    const rows2 = r2.data.ResourceList || r2.data.Data || (Array.isArray(r2.data) ? r2.data : []);
    console.log('ID nested rows:', rows2.length, ' | keys:', Object.keys(r2.data));
    if (rows2.length) console.log('first child by ID:', JSON.stringify(rows2[0]).slice(0,400));
    else console.log('raw by ID:', JSON.stringify(r2.data).slice(0,300));
  } catch(e) { console.log('ID err:', e.response?.status, e.message); }
  
  // individual FL endpoint
  try {
    const r3 = await axios.get(`${baseURL}/functionallocations/${region.fl_guid}`, { auth, timeout: 15000 });
    console.log('Individual FL keys:', Object.keys(r3.data));
    console.log('Individual FL:', JSON.stringify(r3.data).slice(0,600));
  } catch(e) { console.log('Individual FL err:', e.response?.status, e.message); }
  
  await db.destroy();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
