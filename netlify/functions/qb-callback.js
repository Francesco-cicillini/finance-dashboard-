const crypto = require('crypto');

function encryptToken(data, secret) {
  const iv     = crypto.randomBytes(16);
  const key    = crypto.scryptSync(secret, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc    = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

exports.handler = async (event) => {
  const { code, realmId, state } = event.queryStringParameters || {};
  const cookieHeader = event.headers.cookie || '';
  const storedState  = (cookieHeader.match(/qb_state=([^;]+)/) || [])[1];

  if (!state || state !== storedState) {
    return { statusCode: 400, body: 'Invalid state parameter' };
  }

  const clientId     = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const redirectUri  = process.env.QB_REDIRECT_URI;
  const tokenSecret  = process.env.QB_TOKEN_SECRET;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json'
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return { statusCode: 500, body: `Token exchange failed: ${err}` };
  }

  const tokens = await tokenRes.json();

  const tokenData = {
    access_token:        tokens.access_token,
    refresh_token:       tokens.refresh_token,
    realmId,
    expires_at:          Date.now() + (tokens.expires_in * 1000),
    refresh_expires_at:  Date.now() + (tokens.x_refresh_token_expires_in * 1000)
  };

  const encrypted = encryptToken(tokenData, tokenSecret);

  return {
    statusCode: 302,
    headers: {
      Location: `/?qb_connected=1&realmId=${realmId}`,
    },
    multiValueHeaders: {
      'Set-Cookie': [
        `qb_state=; HttpOnly; Secure; Max-Age=0; Path=/`,
        `qb_tokens=${encrypted}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=8640000`
      ]
    },
    body: ''
  };
};
