const axios   = require('axios');
const CryptoJS = require('crypto-js');

exports.handler = async (event) => {
  const { code, state, realmId } = event.queryStringParameters || {};

  // ── Decode state — extract csrf + bizType ──────────────────────
  let bizType = 'restaurant';
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    bizType = decoded.bizType || 'restaurant';
    // csrf validation would go here if you're storing it server-side
  } catch (e) {
    console.error('Failed to decode state:', e.message);
  }

  // ── Exchange auth code for tokens ──────────────────────────────
  const clientId     = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const redirectUri  = process.env.QB_REDIRECT_URI;
  const tokenSecret  = process.env.QB_TOKEN_SECRET;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let tokens;
  try {
    const response = await axios.post(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: {
          Authorization:  `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    tokens = response.data;
  } catch (err) {
    console.error('Token exchange failed:', err.response?.data || err.message);
    return { statusCode: 500, body: 'Token exchange failed' };
  }

  // ── Encrypt tokens ─────────────────────────────────────────────
  const encrypted = CryptoJS.AES.encrypt(
    JSON.stringify({ ...tokens, realmId }),
    tokenSecret
  ).toString();

  // ── Redirect back to dashboard with bizType in query param ─────
  // bizType goes in the query string (readable before hash fragment)
  // encrypted token goes in the hash (keeps it out of server logs)
  const redirectUrl =
    `/?qb_connected=1&realmId=${realmId}&bizType=${encodeURIComponent(bizType)}` +
    `#qbt=${encodeURIComponent(encrypted)}`;

  return {
    statusCode: 302,
    headers: { Location: redirectUrl },
    body: '',
  };
};
