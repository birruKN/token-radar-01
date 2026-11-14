// Token Launch Radar — the dashboard. It renders window.RADAR (written by main.ts beside this
// folder as ../data.js): the ranked pre-token board, the live-token calibration set it was priced
// from, and a detail view per protocol with the model's arithmetic, its live comparables and its
// farm plan. No network: every byte it shows arrived in data.js. State lives in the URL hash
// (q, category, chain, tier, tab, sort, p) so any view — including a screenshot — is a link.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var CAL = DATA.calibration;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', tier: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The page re-derives a row's value from the printed components, so what the reader sees is the
  // arithmetic board.json carries: curve(TVL) from the fitted line, times the stored factors.
  function recompute(row) {
    var curve = Math.pow(10, CAL.intercept + CAL.slope * Math.log10(Math.max(1, row.tvl_usd)));
    return Math.max(1, Math.round(curve * row.model.category_factor * row.model.momentum_multiplier * row.model.maturity_multiplier));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('tier')) state.tier = p.get('tier');
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tier !== 'all') p.set('tier', state.tier);
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || '(uncategorised)') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Launch Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version })),
        el('span', null, 'Universe ', el('b', { text: DATA.counts.protocols + ' protocols' }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, DATA.counts.board + ' protocols with no token yet, ', el('span', { class: 'hl', text: 'priced off the ones that have one' })),
        el('p', { text: 'Every protocol in the snapshot that records no token is ranked by the value a token would carry if its record stayed as it is. The price comes from the market itself: a curve fitted to the ' + CAL.fitted_n + ' tokenised protocols in the same snapshot that carry both a market cap and a TVL. It is a model with a wide, stated error band — not a prediction that a token will exist.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.counts.watchlist + ' / ' + DATA.counts.watchlist })),
        el('div', { class: 'fact' }, el('span', { text: 'Rows ranked' }), el('b', { text: String(DATA.counts.board) })),
        el('div', { class: 'fact' }, el('span', { text: 'Above the $50M floor' }), el('b', { text: String(DATA.counts.watchlist + DATA.counts.large) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live comps fitted' }), el('b', { text: String(CAL.fitted_n) }))
      )
    );
  }

  function strip() {
    return el('section', { class: 'strip' },
      el('h2', { text: 'The model' }),
      el('p', null,
        'log10(market cap) = ', el('span', { class: 'fig', text: CAL.intercept.toFixed(2) }), ' + ',
        el('span', { class: 'fig', text: CAL.slope.toFixed(2) }), ' x log10(TVL), fitted to the snapshot\u2019s live tokens. ' +
        'The slope under 1 is the market\u2019s size discount: a token\u2019s multiple falls from about 0.44x TVL at $10M to about 0.03x at $5B. ' +
        'Scatter is ', el('span', { class: 'fig', text: CAL.scatter_dex.toFixed(2) + ' dex' }),
        ', so each row also carries a one-sigma band. Category, momentum and maturity adjust the curve; no name is ever special-cased.'
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || '(uncategorised)'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function select(id, label, values, current, onchange) {
      var s = el('select', { id: id, 'aria-label': label },
        values.map(function (v) { return el('option', { value: v[0], text: v[1], selected: v[0] === current ? 'selected' : null }); }));
      s.addEventListener('change', function () { onchange(s.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    function segButton(tier, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tier === tier ? 'true' : 'false', text: label,
        onclick: function () { state.tier = tier; writeHash(); render(); } });
    }
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board',
      onclick: function () { state.tab = 'board'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live comps (' + DATA.live.length + ')',
      onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      select('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      select('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Board tier' }),
        el('div', { class: 'seg' }, segButton('all', 'All'), segButton('watchlist', 'Watchlist'), segButton('large', 'Large'), segButton('early', 'Early'))),
      el('span', { class: 'count', text: state.tab === 'board' ? filtered().length + ' rows shown' : DATA.live.length + ' live-token protocols' }),
      el('div', { class: 'tabs' }, pre, live)
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; }
        render();
      } }, label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null));
  }

  function tierChip(r) {
    if (r.tier === 'watchlist') return el('span', { class: 'chip wl', text: 'Watchlist' });
    if (r.tier === 'large') return el('span', { class: 'chip lg', text: 'Large' });
    return el('span', { class: 'chip er', text: 'Early' });
  }

  function boardTable() {
    var list = sorted(filtered());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { class: 'sub', text: 'Clear the search or widen the filters to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.tier = 'all'; writeHash(); render();
        } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d;
      tbody.appendChild(el('tr', { 'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }), tierChip(r),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain unrecorded') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (g === null ? '' : g >= 0 ? 'pos' : 'neg'), text: fmtPct(g) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.multiple.toFixed(2) + 'x' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))),
        el('td', null, el('span', { class: 'status', text: 'no token on record' }))
      ));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Pre-token protocols ranked by implied value. Select a row for its model, its live comparables and its farm plan.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d TVL'), sortHeader('age', 'Age'), sortHeader('multiple', 'x TVL'),
          sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'Token' }))),
        tbody)));
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain unrecorded') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple === null ? 'n/a' : r.multiple.toFixed(2) + 'x' }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'The calibration set: every live-token protocol in the snapshot with a recorded market cap. The curve was fitted to these rows — their caps are the market\u2019s own figures, not the model\u2019s.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
          el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'x TVL' }),
          el('th', { scope: 'col', text: '7d TVL' }), el('th', { scope: 'col', text: 'Token' }))),
        tbody)));
  }

  function methodPanel() {
    var factors = Object.keys(DATA.calibration.category_factors).sort().map(function (c) {
      return el('span', null, c + ' ', el('b', { text: 'x' + DATA.calibration.category_factors[c].toFixed(2) }));
    });
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How each implied value is derived' }),
      el('ol', null,
        el('li', null, el('b', { text: 'Fit the market. ' }), 'A power law is fitted by least squares to the live protocols that carry both a market cap and a TVL (one 2.5-sigma clip, then a refit).'),
        el('li', null, el('b', { text: 'Adjust by category. ' }), 'Each category\u2019s median residual against the curve, shrunk toward zero and clamped, so categories whose tokens capture little of their TVL (lending, liquid staking) price lower and those that capture more (RWA, basis trading) price higher.'),
        el('li', null, el('b', { text: 'Adjust by the protocol. ' }), 'Momentum from its seven-day TVL change, and maturity from how long it has run with no token. Both are small and stated below.'),
        el('li', null, el('b', { text: 'Rank, with the band showing. ' }), 'The one-sigma band is the fitted scatter: the market prices similar protocols across that whole range, and any single point value should be read inside it.')
      ),
      el('div', { class: 'formula', text: 'implied = 10^(' + CAL.intercept.toFixed(4) + ' + ' + CAL.slope.toFixed(4) + ' x log10(TVL))  x  category factor  x  (1 + 0.30 x clamp(7d, -40, +60)/100)  x  (0.75 + 0.25 x min(age, 1095d)/1095)' }),
      el('div', { class: 'factors' }, factors),
      el('p', { class: 'sub', text: 'Board membership is a rule: every watchlist protocol, plus every other pre-token protocol that is an independent launch candidate — not an exchange, not a versioned pool, and not a wrapped, staked or bridged product of a token that already trades. Exchanges, wrapped products and versioned pools record no token of their own to launch, so they are set aside with the live set, not ranked.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var m = row.model;
    var again = recompute(row);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.counts.board + ' \u00b7 ' + row.tier + ' tier' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' \u00b7 ' + ((row.chains || []).join(', ') || 'chain unrecorded') + ' \u00b7 tracked since ' + (row.listed_at || 'an unrecorded date') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    function stat(label, value, cls) { return el('div', cls ? { class: cls } : null, el('span', { text: label }), el('b', { class: 'num', text: value })); }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, step by step' }),
      el('div', { class: 'equation' },
        stat('TVL (snapshot)', fmtUsd(row.tvl_usd)),
        stat('Curve value at this TVL', fmtUsd(m.curve_value_usd)),
        stat('Category factor', 'x' + m.category_factor.toFixed(2)),
        stat('Momentum (7d ' + fmtPct(row.change_7d) + ')', 'x' + m.momentum_multiplier.toFixed(2)),
        stat('Maturity (' + fmtAge(row.age_days) + ' tokenless)', 'x' + m.maturity_multiplier.toFixed(2)),
        stat('Implied value', fmtUsd(row.implied_value_usd), 'total')
      ),
      el('p', { class: 'sub', text: 'One-sigma band: ' + fmtUsd(row.range_low_usd) + ' to ' + fmtUsd(row.range_high_usd) + ' — the spread across which the market prices comparable live protocols. This page recomputes the row from the components above and gets ' + fmtUsd(again) + (again === row.implied_value_usd ? ', the number board.json carries.' : ', within rounding of the printed factors of the board\u2019s number.') + ' The value is what a token would carry if this record stayed as it is; it says nothing about whether or when one is issued.' })
    ));
    var peers = (CAL.comps[row.category || '(uncategorised)'] || []);
    if (peers.length) {
      var pt = el('tbody');
      peers.forEach(function (c) {
        pt.appendChild(el('tr', null,
          el('td', { text: c.name }), el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }), el('td', { class: 'num', text: c.multiple.toFixed(2) + 'x' })));
      });
      var hasFactor = CAL.category_factors[row.category || '(uncategorised)'] !== undefined;
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Live comparables in ' + (row.category || 'this category') }),
        el('table', { class: 'comps' }, el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
          el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'x TVL' }))), pt),
        el('p', { class: 'sub', text: hasFactor
          ? 'The largest tokenised protocols of the same category in the same snapshot: the evidence the category factor is fitted from.'
          : 'Too few tokenised protocols in this category carry a market cap to fit a category adjustment from, so this row rides the global curve at a factor of x1.00. The peers above are shown for scale, not as the price source.' })
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        return el('li', null,
          el('b', { text: at >= 0 ? s.slice(0, at) : s }),
          at >= 0 ? el('span', { class: 'cost', text: s.slice(at + 1) }) : null);
      })),
      el('p', { class: 'sub', text: 'Costs and times are planning figures for one wallet, derived from the protocol\u2019s category, chain and size. Nothing here is financial advice; a points programme is the protocol\u2019s to run or not run.' })
    ));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(strip());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    if (state.tab === 'board') shell.appendChild(methodPanel());
    shell.appendChild(el('footer', { class: 'foot' },
      el('p', { text: 'Source: ' + DATA.source + '. "No token on record" is DefiLlama\u2019s record, not proof a protocol has no token anywhere.' }),
      el('p', { text: 'Implied values are this board\u2019s model, ' + DATA.model_version + ', computed from the snapshot\u2019s own figures at run time. They are not prices, offers or predictions.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
  }

  readHash();
  render();
  if (state.selected) openDetail(state.selected);
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
