const crypto = require('crypto');

exports.handler = async (event) => {
  const clientId     = process.env.QB_CLIENT_ID;
  const redirectUri  = process.env.QB_REDIRECT_URI;

  // Read bizType from query param — passed by the dashboard before redirecting
  const bizType = event.queryStringParameters?.bizType || 'restaurant';

  // Encode bizType into state so it survives the OAuth round-trip
  const csrfToken = crypto.randomBytes(16).toString('hex');
  const state     = Buffer.from(JSON.stringify({ csrf: csrfToken, bizType })).toString('base64');

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    scope:         'com.intuit.quickbooks.accounting',
    redirect_uri:  redirectUri,
    state,
  });

  const authUrl = `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;

  return {
    statusCode: 302,
    headers: { Location: authUrl },
    body: '',
  };
};
