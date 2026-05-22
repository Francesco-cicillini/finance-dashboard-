exports.handler = async () => {
  const clientId    = process.env.QB_CLIENT_ID;
  const redirectUri = process.env.QB_REDIRECT_URI;
  const scope       = 'com.intuit.quickbooks.accounting';
  const state       = Math.random().toString(36).slice(2);

  const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2');
  authUrl.searchParams.set('client_id',     clientId);
  authUrl.searchParams.set('redirect_uri',  redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope',         scope);
  authUrl.searchParams.set('state',         state);

  return {
    statusCode: 302,
    headers: {
      Location:   authUrl.toString(),
      'Set-Cookie': `qb_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
    },
    body: ''
  };
};
