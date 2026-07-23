// Temporary OAuth callback — delete after getting the tokens.
module.exports = async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    res.status(400).send(`<h2>Error: ${error}</h2><p>${error_description}</p>`);
    return;
  }

  if (!code) {
    res.status(400).send('<h2>No se recibió código de autorización</h2>');
    return;
  }

  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientSecret) {
    res.status(500).send('<h2>Falta LINKEDIN_CLIENT_SECRET en Vercel</h2>');
    return;
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'https://copy-vault-gamma.vercel.app/api/linkedin-callback',
    client_id: '786ptou2qnkjc3',
    client_secret: clientSecret,
  });

  const r = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await r.json();

  if (data.error) {
    res.status(400).send(`<h2>Error: ${data.error}</h2><p>${data.error_description}</p>`);
    return;
  }

  const accessDays = Math.floor((data.expires_in || 0) / 86400);
  const refreshDays = Math.floor((data.refresh_token_expires_in || 0) / 86400);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <style>
      body { font-family: monospace; padding: 2rem; background: #111; color: #eee; }
      h2 { color: #FF4800; }
      .token { background: #222; padding: 1rem; border-radius: 6px; word-break: break-all; margin: 0.5rem 0 1.5rem; }
      .label { color: #aaa; font-size: 0.85rem; margin-bottom: 0.25rem; }
      .warn { color: #FF4800; margin-top: 2rem; font-size: 0.9rem; }
    </style>
    <h2>Tokens obtenidos</h2>
    <p>Guárdalos como GitHub Secrets. No compartas esta página.</p>

    <div class="label">Secret name: <strong>LINKEDIN_ACCESS_TOKEN</strong> (caduca en ~${accessDays} días)</div>
    <div class="token">${data.access_token}</div>

    ${data.refresh_token ? `
    <div class="label">Secret name: <strong>LINKEDIN_REFRESH_TOKEN</strong> (caduca en ~${refreshDays} días)</div>
    <div class="token">${data.refresh_token}</div>
    ` : ''}

    <p class="warn">Borra esta página de Vercel cuando hayas guardado los tokens.</p>
  `);
};
