const { decryptToken } = require('./_qb-token-store');

const QB_BASE = 'https://sandbox-quickbooks.api.intuit.com';

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
  'Expense:Supplies',
  'Expense:Insurance',
  'Expense:Repairs & Maintenance',
  'Expense:Professional Fees',
  'Expense:Other / Misc'
];

function mapQBAccountToCategory(accountName, accountType) {
  const n = (accountName || '').toLowerCase();
  const t = (accountType || '').toLowerCase();

  if (t === 'income' || t === 'revenue') {
    if (n.includes('cater') || n.includes('event'))                               return 'Revenue:Catering & Events';
    if (n.includes('retail') || n.includes('product') || n.includes('packaged')) return 'Revenue:Retail / Packaged Goods';
    return 'Revenue:Food & Beverage Sales';
  }

  if (t === 'cost of goods sold') {
    if (n.includes('bev') || n.includes('drink') || n.includes('liquor') || n.includes('bar')) return 'COGS:Beverage Cost';
    if (n.includes('food') || n.includes('ingredi') || n.includes('produce'))                  return 'COGS:Food Cost';
    return 'COGS:Other COGS';
  }

  if (t === 'expense' || t === 'other expense') {
    if (n.includes('payroll') || n.includes('wage') || n.includes('labor') || n.includes('salary')) return 'Expense:Labor & Payroll';
    if (n.includes('rent')    || n.includes('lease'))                                               return 'Expense:Rent';
    if (n.includes('utilit')  || n.includes('electric') || n.includes('gas'))                      return 'Expense:Utilities';
    if (n.includes('market')  || n.includes('adverti'))                                             return 'Expense:Marketing';
    if (n.includes('software')|| n.includes('subscript'))                                           return 'Expense:Software & Subscriptions';
    if (n.includes('suppli')  || n.includes('paper') || n.includes('clean'))                       return 'Expense:Supplies';
    if (n.includes('insur'))                                                                         return 'Expense:Insurance';
    if (n.includes('repair')  || n.includes('mainten'))                                             return 'Expense:Repairs & Maintenance';
    if (n.includes('legal')   || n.includes('account') || n.includes('consult'))                   return 'Expense:Professional Fees';
    return 'Expense:Other / Misc';
  }

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

function parsePLToBudget(plReport) {
  const budget = {};
  CATEGORIES.forEach(c => budget[c] = 0);

  function processRow(row, sectionType) {
    if (row.type === 'Section') {
      const header = row.Header?.ColData?.[0]?.value || '';
      let st = sectionType;
      if (/income|revenue|sales/i.test(header))  st = 'income';
      else if (/cost of goods/i.test(header))     st = 'cost of goods sold';
      else if (/expense/i.test(header))           st = 'expense';
      (row.Rows?.Row || []).forEach(r => processRow(r, st));
      return;
    }
    if (row.type === 'Data') {
      const accountName = row.ColData?.[0]?.value || '';
      const amount      = parseFloat(row.ColData?.[1]?.value || 0);
      if (!accountName || isNaN(amount)) return;
      const cat = mapQBAccountToCategory(accountName, sectionType);
      if (cat) budget[cat] = (budget[cat] || 0) + Math.abs(amount);
    }
  }

  (plReport?.Rows?.Row || []).forEach(r => processRow(r, 'expense'));
  return budget;
}

function inferTypeFromTxType(qbType) {
  const t = (qbType || '').toLowerCase();
  if (t.includes('invoice') || t.includes('payment') || t.includes('sales receipt')) return 'income';
  return 'expense';
}

function parseTransactions(txReport) {
  const transactions = [];
  (txReport?.Rows?.Row || [])
    .filter(r => r.type === 'Data')
    .forEach(row => {
      const cols    = row.ColData || [];
      const date    = cols[0]?.value || '';
      const type    = cols[1]?.value || '';
      const name    = cols[3]?.value || cols[4]?.value || '';
      const account = cols[5]?.value || '';
      const amount  = parseFloat(cols[7]?.value || 0);
      if (!date || isNaN(amount)) return;

      transactions.push({
        date,
        category: mapQBAccountToCategory(account, inferTypeFromTxType(type)),
        amount:   Math.abs(amount) * (amount < 0 ? -1 : 1),
        name:     name || type,
        source:   'quickbooks'
      });
    });
  return transactions;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    // Get token from Authorization header (sent by dashboard JS)
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

    const [plReport, txReport] = aw
