const crypto = require('crypto');

function decryptToken(encrypted, secret) {
  const [ivHex, encHex] = encrypted.split(':');
  const iv  = Buffer.from(ivHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const key = crypto.scryptSync(secret, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString());
}

async function getValidToken(cookieHeader, tokenSecret) {
  const match = (cookieHeader || '').match(/qb_tokens=([^;]+)/);
  if (!match) throw new Error('No QB token cookie found');

  const tokenData = decryptToken(decodeURIComponent(match[1]), tokenSecret);

  // Still valid (5 min buffer)
  if (tokenData.expires_at > Date.now() + 300000) {
    return tokenData;
  }

  // Refresh
  const clientId     = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const credentials  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const refreshRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json'
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: tokenData.refresh_token
    })
  });

  if (!refreshRes.ok) throw new Error('Token refresh failed');
  const newTokens = await refreshRes.json();

  return {
    ...tokenData,
    access_token:  newTokens.access_token,
    refresh_token: newTokens.refresh_token || tokenData.refresh_token,
    expires_at:    Date.now() + (newTokens.expires_in * 1000)
  };
}

module.exports = { decryptToken, getValidToken };
