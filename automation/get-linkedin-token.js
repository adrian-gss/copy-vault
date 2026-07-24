'use strict';

// One-time LinkedIn OAuth flow to get access + refresh tokens.
// Run as: LINKEDIN_CLIENT_SECRET=xxx node get-linkedin-token.js
// Then save the printed tokens as GitHub secrets.

const http = require('http');
const { exec } = require('child_process');
const { URLSearchParams } = require('url');

const CLIENT_ID = '786ptou2qnkjc3';
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = 'w_organization_social r_organization_social';
const PORT = 3000;

const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
if (!clientSecret) {
  console.error('\nFalta el Client Secret. Ejecútalo así:\n');
  console.error('  LINKEDIN_CLIENT_SECRET=tu_secret node get-linkedin-token.js\n');
  process.exit(1);
}

const state = Math.random().toString(36).substring(2, 10);

const authUrl =
  'https://www.linkedin.com/oauth/v2/authorization' +
  '?response_type=code' +
  `&client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&state=${encodeURIComponent(state)}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') { res.end(''); return; }

  const error = url.searchParams.get('error');
  if (error) {
    const desc = url.searchParams.get('error_description') || '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Error: ${error}</h2><p>${desc}</p>`);
    console.error('\nError de LinkedIn:', error, desc);
    server.close();
    return;
  }

  if (url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Error: state no coincide</h2>');
    server.close();
    return;
  }

  const code = url.searchParams.get('code');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: clientSecret,
  });

  let data;
  try {
    const r = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    data = await r.json();
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Error al obtener token</h2>');
    console.error(e);
    server.close();
    return;
  }

  if (data.error) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Error: ${data.error}</h2><p>${data.error_description}</p>`);
    console.error('\nError:', data.error, data.error_description);
    server.close();
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h2>Autorizado correctamente. Puedes cerrar esta pestaña.</h2>');

  const accessDays = Math.floor((data.expires_in || 0) / 86400);
  const refreshDays = Math.floor((data.refresh_token_expires_in || 0) / 86400);

  console.log('\n\n Tokens obtenidos — guárdalos como GitHub Secrets:\n');
  console.log('─────────────────────────────────────────────────');
  console.log('Secret name: LINKEDIN_ACCESS_TOKEN');
  console.log('Value:      ', data.access_token);
  console.log(`(caduca en ~${accessDays} días)\n`);
  if (data.refresh_token) {
    console.log('Secret name: LINKEDIN_REFRESH_TOKEN');
    console.log('Value:      ', data.refresh_token);
    console.log(`(caduca en ~${refreshDays} días)\n`);
  }
  console.log('─────────────────────────────────────────────────\n');

  server.close();
});

server.listen(PORT, () => {
  console.log('\nAbriendo LinkedIn para autorizar...');
  exec(`open "${authUrl}"`);
});
