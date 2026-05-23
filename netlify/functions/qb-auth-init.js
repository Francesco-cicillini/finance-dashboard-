exports.handler = async (event) => {
  const clientId    = process.env.QB_CLIENT_ID;
  const redirectUri = process.env.QB_REDIRECT_URI;
  const scope       = 'com.intuit.quickbooks.accounting';

  // Read bizType from query param — set by the dashboard before redirecting
  const bizType = (event.queryStringParameters?.bizType || 'restaurant').trim();

  // Encode bizType into state so it survives the OAuth round-trip
  // State also carries a random token for CSRF protection
  const csrf  = Math.random().toString(36).slice(2);
  const state = Buffer.from(JSON.stringify({ csrf, bizType })).toString('base64');

  const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2');
  authUrl.searchParams.set('client_id',     clientId);
  authUrl.searchParams.set('redirect_uri',  redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope',         scope);
  authUrl.searchParams.set('state',         state);

  return {
    statusCode: 302,
    headers: {
      Location:     authUrl.toString(),
      // Store csrf in cookie for validation in callback
      'Set-Cookie': `qb_csrf=${csrf}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
    },
    body: ''
  };
};
