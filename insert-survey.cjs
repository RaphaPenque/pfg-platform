// Andrea Marchionni — Saltend survey insertion script
// Submits her survey response via the platform's own /api/survey/submit endpoint
// Token from original email sent 16 Apr: 3d1ddca0ce8efc758796fdaa3ccc66e18532412a781ee0115a88ff2e74c35ce3

const https = require('https');

const BASE = 'https://pfg-platform.onrender.com';

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Step 1: Check if the token is still valid
  console.log('Checking token...');
  const tokenCheck = await request('GET', '/api/survey/token-data?token=3d1ddca0ce8efc758796fdaa3ccc66e18532412a781ee0115a88ff2e74c35ce3');
  console.log('Token check:', tokenCheck.status, JSON.stringify(tokenCheck.body).slice(0, 200));

  if (tokenCheck.status !== 200) {
    console.log('\nToken not found — will insert via direct DB method');
    return;
  }

  // Step 2: Submit the survey response
  console.log('\nSubmitting survey...');
  const payload = {
    token: '3d1ddca0ce8efc758796fdaa3ccc66e18532412a781ee0115a88ff2e74c35ce3',
    scores: {
      planning_preparation: 4,
      quality_of_work: 5,
      health_safety: 4,
      supervision: 5,
      project_manager: 4,
      overall_performance: 5
    },
    nps: 9,
    comments: "We are really pleased with the PowerForce Global manpower crew performance during 2026 GT2 CI. This was the first time we employed PFG for Saltend outages, and the result was very positive. The only point of improvement we would recommend is that all trainings and certificates if possible should be sorted within 2/3 weeks before the outage please. In SAL we need to issue a letter to customer (validation that all people are ok to work at site) 1 week before outage starting date, so certificates should not be issued within a week otherwise there is no time to properly check or assess them. Apart from that, the entire planning process was very professional and satisfactory. Stephen Haslam being on site was a real added value and we hope this solution will be available again for future outages.",
    respondent_name: "Andrea Marchionni",
    respondent_email: "andrea.marchionni.w5@mhi.com"
  };

  const result = await request('POST', '/api/survey/submit', payload);
  console.log('Submit result:', result.status, JSON.stringify(result.body).slice(0, 300));
}

main().catch(console.error);
