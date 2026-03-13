const knex = require('knex');
const db = knex({ client: 'mssql', connection: { host: 'mssql', port: 1433, user: 'sa', password: 'YourStrong!Passw0rd', database: 'xeonb_crm', options: { encrypt: false, trustServerCertificate: true } } });
const axios = require('axios');

async function main() {
  const apiUrl = await db('settings').where('key','assetic_api_url').first();
  const apiKey = await db('settings').where('key','assetic_api_key_1').first();
  const username = await db('settings').where('key','assetic_username_1').first();
  
  const baseURL = apiUrl.value.replace(/\/$/, '') + '/api/v2';
  const auth = { username: username.value, password: apiKey.value };
  
  const region = await db('assetic_functional_locations').where('fl_type', 'Region').first();
  console.log('Testing region:', region.fl_guid, 'name:', region.fl_name, 'id:', region.fl_id);
  
  // Test nested FL endpoint with GUID
  try {
    const resp = await axios.get(`${baseURL}/functionallocations/${region.fl_guid}/functionallocations`, {
      auth, params: { 'requestParams.pageSize': 100 }, timeout: 15000
    });
    console.log('GUID Status:', resp.status, 'Keys:', Object.keys(resp.data));
    const rows = resp.data.ResourceList || resp.data.Data || resp.data;
    console.log('GUID Rows:', Array.isArray(rows) ? rows.length : typeof rows);
    if (Array.isArray(rows) && rows.length > 0) console.log('First:', JSON.stringify(rows[0]).slice(0, 400));
    else console.log('Sample:', JSON.stringify(resp.data).slice(0, 400));
  } catch (err) {
    console.log('GUID error:', err.response?.status, err.message);
  }
  
  // Test with numeric ID
  try {
    const resp2 = await axios.get(`${baseURL}/functionallocations/${region.fl_id}/functionallocations`, {
      auth, params: { 'requestParams.pageSize': 100 }, timeout: 15000
    });
    console.log('ID Status:', resp2.status);
    const rows2 = resp2.data.ResourceList || resp2.data.Data || resp2.data;
    console.log('ID Rows:', Array.isArray(rows2) ? rows2.length : typeof rows2);
    if (Array.isArray(rows2) && rows2.length > 0) {
      console.log('ID First:', JSON.stringify(rows2[0]).slice(0, 400));
    } else {
      console.log('ID Sample:', JSON.stringify(resp2.data).slice(0, 400));
    }
  } catch (err2) {
    console.log('ID error:', err2.response?.status, err2.message);
  }
  
  // Also check individual FL endpoint
  try {
    const resp3 = await axios.get(`${baseURL}/functionallocations/${region.fl_guid}`, {
      auth, timeout: 15000
    });
    console.log('Individual FL keys:', Object.keys(resp3.data));
    console.log('Individual FL sample:', JSON.stringify(resp3.data).slice(0, 500));
  } catch (err3) {
    console.log('Individual FL error:', err3.response?.status, err3.message);
  }
  
  await db.destroy();
}
main().catch(e => { console.error(e.message); process.exit(1); });
