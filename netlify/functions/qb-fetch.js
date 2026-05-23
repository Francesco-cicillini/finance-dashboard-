const { decryptToken } = require('./_qb-token-store');

const QB_BASE = 'https://quickbooks.api.intuit.com';

const CATEGORIES = [
  'Revenue:Food & Beverage Sales',
  'Revenue:Catering & Events',
  'Revenue:Retail / Packaged Goods',
  'COGS:Food Cost',
  'COGS:Beverage Cost',
  'COGS:Other COGS',
  'Expense:Labor & Payroll',
  'Expense:Rent',
  'Expense:Utilities',
  'Expense:Marketing',
  'Expense:Software & Subscriptions',
  'Expense:Supplies & Packaging',
  'Expense:Insurance',
  'Expense:Repairs & Maintenance',
  'Expense:Professional Fees',
  'Expense:Other / Misc'
];

function mapQBAccountToCategory(accountName, accountType) {
  const n = (accountName || '').toLowerCase();
  const t = (accountType || '').toLowerCase();

  if (n.includes('grubhub') && (n.includes('credit') || n.includes('payout'))) return 'Revenue:Food & Beverage Sales';
  if (n.includes('square inc payment') || n.includes('mikes kitchen dine-in'))  return 'Revenue:Food & Beverage Sales';
  if (n.includes('tri-state beverage') || n.includes('tristate beverage'))       return 'COGS:Beverage Cost';
  if (n.includes('metro fresh foods'))                                            return 'COGS:Food Cost';
  if (n.includes('adp payroll') || n.includes('adp wages'))                      return 'Expense:Labor & Payroll';
  if (n.includes('empire state realty'))                                          return 'Expense:Rent';
  if (n.includes('nyc water board') || n.includes('coned') || n.includes('con ed')) return 'Expense:Utilities';
  if (n.includes('quickpack supplies') || n.includes('cintas corp'))             return 'Expense:Supplies & Packaging';
  if (n.includes('grubhub services fee') || n.includes('grubhub fee'))           return 'Expense:Marketing';
  if (n.includes('google ads'))                                                   return 'Expense:Marketing';
  if (n.includes('safe harbor insurance'))                                        return 'Expense:Insurance';
  if (n.includes('heartland payment'))                                            return 'Expense:Other / Misc';

  if (t === 'income' || t === 'revenue' || n === 'sales') {
    if (n.includes('cater') || n.includes('event'))                               return 'Revenue:Catering & Events';
    if (n.includes('retail') || n.includes('product') || n.includes('packaged')) return 'Revenue:Retail / Packaged Goods';
    return 'Revenue:Food & Beverage Sales';
  }
  if (t === 'cost of goods sold' || n.includes('direct supplies') || n.includes('direct materials')) {
    if (n.includes('bev') || n.includes('drink') || n.includes('liquor') || n.includes('bar')) return 'COGS:Beverage Cost';
    if (n.includes('food') || n.includes('ingredi') || n.includes('produce'))                  return 'COGS:Food Cost';
    return 'COGS:Other COGS';
  }
  if (n === 'wages' || n.includes('payroll') || n.includes('wage') || n.includes('labor') || n.includes('salary')) return 'Expense:Labor & Payroll';
  if (n === 'building & land rent' || n.includes('rent') || n.includes('lease'))                                    return 'Expense:Rent';
  if (n === 'utilities' || n.includes('utilit') || n.includes('electric') || n.includes('gas') || n.includes('water')) return 'Expense:Utilities';
  if (n === 'supplies' || n.includes('suppli') || n.includes('paper') || n.includes('clean') || n.includes('uniform')) return 'Expense:Supplies & Packaging';
  if (n === 'advertising & marketing' || n.includes('market') || n.includes('adverti') || n.includes('promo'))     return 'Expense:Marketing';
  if (n === 'insurance' || n.includes('insur'))                                                                      return 'Expense:Insurance';
  if (n.includes('repair') || n.includes('mainten'))                                                                return 'Expense:Repairs & Maintenance';
  if (n.includes('software') || n.includes('subscript') || n.includes('saas'))                                     return 'Expense:Software & Subscriptions';
  if (n.includes('legal') || n.includes('accounting') || n.includes('consult') || n.includes('professional'))      return 'Expense:Professional Fees';
  if (n === 'bank and credit card fees' || n === 'commissions & fees' || n.includes('bank fee') || n.includes('commission')) return 'Expense:Other / Misc';

  return 'Expense:Other / Misc';
}

async function fetchPLReport(realmId, accessToken, startDate, endDate) {
  const url = `${QB_BASE}/v3/company/${realmId}/reports/ProfitAndLoss` +
    `?start_date=${startDate}&end_date=${endDate}&summarize_column_by=Month&minorversion=65`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`QB P&L error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchTransactions(realmId, accessToken, startDate, endDate) {
  const url = `${QB_BASE}/v3/company/${realmId}/reports/TransactionList` +
    `?start_date=${startDate}&end_date=${endDate}&minorversion=65`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`QB TransactionList error: ${res.status} ${await res.text()}`);
  return res.json();
}

function inferTypeFromTxType(qbType) {
  const t = (qbType || '').toLowerCase();
  if (t.includes('invoice') || t.includes('payment') || t.includes('sales receipt')) return 'income';
  return 'expense';
}

function parseTransactions(txReport) {
  const transactions = [];

  // Log column headers so we know the exact column order for this QB account
  const colHeaders = txReport?.Columns?.Column?.map(c => c.ColTitle) || [];
  console.log('TX_COLUMNS:', JSON.stringify(colHeaders));

  // Log first 3 raw rows so we can see the actual data shape
  const rawRows = (txReport?.Rows?.Row || []).filter(r => r.type === 'Data').slice(0, 3);
  console.log('TX_SAMPLE_ROWS:', JSON.stringify(rawRows.map(r => r.ColData)));

  (txReport?.Rows?.Row || [])
    .filter(r => r.type === 'Data')
    .forEach(row => {
      const cols = row.ColData || [];

      // Use column headers to find the right indices dynamically
      const get = (label) => {
        const idx = colHeaders.indexOf(label);
        return idx >= 0 ? (cols[idx]?.value || '') : '';
      };

      const date    = get('Date')   || cols[0]?.value || '';
      const type    = get('Transaction Type') || cols[1]?.value || '';
      const name    = get('Name')   || get('Memo/Description') || cols[3]?.value || cols[4]?.value || '';
      const account = get('Account') || cols[5]?.value || '';
      const amountRaw = get('Amount') || cols[7]?.value || '0';
      const amount  = parseFloat(amountRaw);

      if (!date || isNaN(amount) || amount === 0) return;

      const mapTarget = name || account;
      const category  = mapQBAccountToCategory(mapTarget, inferTypeFromTxType(type));

      transactions.push({
        date,
        category,
        amount: Math.abs(amount) * (amount < 0 ? -1 : 1),
        name:   name || type,
        source: 'quickbooks'
      });
    });

  console.log('TX_COUNT:', transactions.length);
  return transactions;
}

function buildBudgetFromTransactions(transactions) {
  const annual = {};
  CATEGORIES.forEach(c => annual[c] = 0);

  transactions.forEach(tx => {
    if (!annual[tx.category]) annual[tx.category] = 0;
    annual[tx.category] += Math.abs(tx.amount);
  });

  const monthly = {};
  Object.keys(annual).forEach(k => {
    monthly[k] = Math.round(annual[k] / 12);
  });

  console.log('BUDGET_MONTHLY:', JSON.stringify(monthly, null, 2));
  return monthly;
}

function extractAllAccountNames(plReport, txReport) {
  const names = new Set();

  function walkPL(rows) {
    if (!rows) return;
    for (const row of rows) {
      const val = row.ColData?.[0]?.value;
      if (val) names.add(val);
      if (row.Rows?.Row) walkPL(row.Rows.Row);
    }
  }
  walkPL(plReport?.Rows?.Row);

  (txReport?.Rows?.Row || [])
    .filter(r => r.type === 'Data')
    .forEach(row => {
      const name    = row.ColData?.[3]?.value || row.ColData?.[4]?.value;
      const account = row.ColData?.[5]?.value;
      if (name)    names.add(name);
      if (account) names.add(account);
    });

  return [...names].filter(Boolean).sort();
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    const encrypted  = authHeader.replace('Bearer ', '').trim();
    if (!encrypted) throw new Error('No token provided');

    const tokenSecret = process.env.QB_TOKEN_SECRET;
    const tokenData   = decryptToken(decodeURIComponent(encrypted), tokenSecret);

    if (tokenData.expires_at < Date.now()) throw new Error('Token expired — please reconnect QuickBooks');

    const { access_token, realmId } = tokenData;

    const now       = new Date();
    const endDate   = now.toISOString().slice(0, 10);
    const startDate = new Date(new Date().setFullYear(now.getFullYear() - 1)).toISOString().slice(0, 10);

    const [plReport, txReport] = await Promise.all([
      fetchPLReport(realmId, access_token, startDate, endDate),
      fetchTransactions(realmId, access_token, startDate, endDate)
    ]);

    const rawAccountNames = extractAllAccountNames(plReport, txReport);
    console.log('QB_ACCOUNTS_FOUND:', JSON.stringify(rawAccountNames, null, 2));

    const transactions  = parseTransactions(txReport);
    const budgetMonthly = buildBudgetFromTransactions(transactions);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        realmId,
        dateRange: { startDate, endDate },
        budget: budgetMonthly,
        transactions,
        raw: { accountsFound: rawAccountNames }
      })
    };

  } catch (err) {
    console.error('qb-fetch error:', err.message);
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
