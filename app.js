/* A股量化因子有效性看板 前端逻辑 */
let SUMMARY = null, EFF = null;
let curCat = 'all', curFactor = null, sortKey = 'icir', sortAsc = false, curH = 20;
let icChart, moChart, qChart, quadChart;

const $ = s => document.querySelector(s);
const fmt = (v, n = 3) => (v === null || v === undefined || isNaN(v)) ? '-' : (+v).toFixed(n);
const cls = v => v > 0 ? 'pos' : (v < 0 ? 'neg' : '');
const esc = t => String(t ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function renderStyle(st) {
  const banner = $('#styleBanner');
  if (!st) { if (banner) banner.style.display = 'none'; return; }
  if ($('#stylePlain')) $('#stylePlain').innerHTML = st.text_plain || st.text || '';
  if ($('#styleText')) $('#styleText').innerHTML = st.text || '';
  if ($('#styleCaveat')) $('#styleCaveat').textContent = st.caveat || '';
  const chips = (st.signals || []).slice().sort((a, b) => Math.abs(b.recent) - Math.abs(a.recent));
  const el = $('#styleChips');
  if (el) el.innerHTML = chips.map(s => {
    const flip = (s.trend || '').indexOf('方向翻转') >= 0;
    const c = s.strength === '显著' ? 'chip s-strong' : (s.strength === '偏弱' ? 'chip' : 'chip s-weak');
    return `<span class="${c}" title="${esc(s.hint)}">${esc(s.dim)} <b>${esc((s.state || '').split('（')[0])}</b> ` +
      `<span class="${flip ? 'flip' : ''}">IC${(+s.recent).toFixed(3)}${flip ? ' ⇄翻转' : ''}</span></span>`;
  }).join('');
}

function initCharts() {
  icChart = echarts.init($('#icChart'));
  moChart = echarts.init($('#moChart'));
  qChart = echarts.init($('#qChart'));
  if ($('#quadChart')) quadChart = echarts.init($('#quadChart'));
  window.addEventListener('resize', () => { icChart.resize(); moChart.resize(); qChart.resize(); if (quadChart) quadChart.resize(); });
}
const AX = { axisLine: { lineStyle: { color: '#2a3450' } }, axisLabel: { color: '#8b95b5', fontSize: 11 } };
const base = {
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis' },
  legend: { textStyle: { color: '#8b95b5', fontSize: 11 }, top: 0 },
  grid: { left: 50, right: 20, top: 34, bottom: 40 }
};

async function boot() {
  initCharts();
  const [s, e] = await Promise.all([
    fetch('api/summary.json').then(r => r.json()),
    fetch('api/eff.json').then(r => r.json())
  ]);
  SUMMARY = s; EFF = e;
  $('#uniN').textContent = s.universe_n || '-';
  $('#updatedAt').textContent = s.updated_at || '-';
  $('#win').textContent = s.ic_window || 250;
  const ds = s.dates || [];
  if (ds.length) $('#dateRange').textContent = ds[0] + ' ~ ' + ds[ds.length - 1];
  if (s.state === 'error') { const el = $('#updState'); el.textContent = '上次更新失败'; el.className = 'state err'; }
  renderStyle(s.style);
  updateCut();
  renderTable();
  renderQuad();
  const first = sortedRows()[0];
  if (first) selectFactor(first.code);
}

function rowsData() {
  let rows = SUMMARY.factors.filter(f => f.has_data);
  if (curCat !== 'all') rows = rows.filter(f => f.category === curCat);
  return rows;
}
function sortedRows() {
  const k = sortKey;
  const val = r => {
    if (k === 'name') return r.name;
    if (k === 'last_ic') { const li = (r.last_ic_h || {})[curH]; return li ? li.ic : -9; }
    const s = (r.stats_h || {})[curH] || {};
    if (k === 'wow_delta') return s.wow ? s.wow.delta : -9;
    if (k === 'mom_delta') return s.mom ? s.mom.delta : -9;
    const ns = (r.nstats_h || {})[curH] || {};
    if (k === 'n_ic_mean') return ns.ic_mean ?? -9;
    if (k === 'n_icir') return ns.icir ?? -9;
    if (k === 'keep') return keepRatio(r) ?? -9;
    if (k === 'crowd') return (r.crowd && r.crowd.score) ?? -9;
    return s[k] ?? -9;
  };
  return rowsData().slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    const c = typeof va === 'string' ? va.localeCompare(vb) : (va - vb);
    return sortAsc ? c : -c;
  });
}

/* 环比单元格：未超出经验噪声阈值时显示灰色≈，避免把噪声读成风格切换 */
function deltaCell(d, asOf) {
  if (!d) return '<td class="noise">-</td>';
  const beyond = !!d.beyond;
  const arrow = beyond ? (d.delta > 0 ? '↑' : '↓') : '≈';
  const tip = `本期(最近${d.win}个交易日)IC均值 ${d.cur} ｜ 上期 ${d.prev} ｜ 环比 ${d.delta}` +
    `；噪声阈值 |Δ|≥${d.noise95} → ${beyond ? '已超出，可视为真实变化' : '未超出，属噪声区间'}` +
    (asOf ? `；数据截至 ${asOf}（${d.win}日口径需等未来收益实现，实际截止更早）` : '');
  return `<td class="${beyond ? cls(d.delta) : 'noise'}" title="${esc(tip)}">${arrow}${fmt(Math.abs(d.delta), 4)}</td>`;
}

function keepRatio(r) {
  const o = ((r.stats_h || {})[curH] || {}).ic_mean, n = ((r.nstats_h || {})[curH] || {}).ic_mean;
  if (o === undefined || n === undefined || o === null || n === null || Math.abs(o) < 1e-6) return null;
  return n / o;
}

function keepCell(r) {
  const k = keepRatio(r);
  if (k === null || !isFinite(k)) return '<td class="na sep">不适用</td>';
  const pc = k * 100;
  const c = pc >= 100 ? 'keep-hi' : (pc < 40 ? 'keep-lo' : '');
  const tip = '中性IC均值 ÷ 原始IC均值 = ' + pc.toFixed(0) + '%；<0 表示方向被反转（原始IC基本全靠暴露）';
  return `<td class="${c}" title="${esc(tip)}">${pc.toFixed(0)}%</td>`;
}

function crowdCell(cd) {
  if (!cd || cd.score === null || cd.score === undefined) return '<td class="na sep">-</td>';
  const v = cd.score;
  const c = v >= 80 ? 'crowd-hi' : (v >= 60 ? 'crowd-mid' : 'crowd-lo');
  const rk = cd.rank || {};
  const tip = '拥挤度 ' + v + '（越高越挤）｜多头组=' + (cd.long_side || '') +
    '｜定价分位' + (rk.valuation ?? '-') + ' 资金分位' + (rk.money ?? '-') +
    ' 关注度分位' + (rk.attention ?? '-') + ' 风险分位' + (rk.risk ?? '-') +
    '｜四维为历史分位，>80 提示极端定价/资金集中';
  return `<td class="${c} sep" title="${esc(tip)}">${v.toFixed(0)}</td>`;
}

function updateCut() {
  const el = $('#hCut');
  if (!el || !SUMMARY) return;
  let mx = '';
  for (const f of SUMMARY.factors) {
    const s = (f.stats_h || {})[curH];
    if (s && s.last_date && s.last_date > mx) mx = s.last_date;
  }
  el.textContent = mx ? `本口径IC数据截至 ${mx}（未来${curH}日收益需已实现，故滞后于盘面）` : '';
  const th = document.querySelector('#tbl thead th[data-k="last_ic"]');
  if (th) th.textContent = `最新IC(${curH}日)`;
}

function renderTable() {
  const tb = $('#tbl tbody');
  tb.innerHTML = '';
  for (const r of sortedRows()) {
    const s = (r.stats_h || {})[curH] || {};
    const li = (r.last_ic_h || {})[curH] || {};
    const ns = (r.nstats_h || {})[curH] || {};
    const tr = document.createElement('tr');
    if (r.code === curFactor) tr.classList.add('sel');
    tr.innerHTML = `
      <td><span class="catLabel">${r.category_name}</span><span class="fname">${r.name}</span><span class="fcode">${r.code}</span></td>
      <td class="${cls(li.ic)}" title="${esc('本口径(未来'+curH+'日)最新IC · '+(li.d||''))}">${fmt(li.ic, 4)}</td>
      <td class="${cls(s.ic_mean)}">${fmt(s.ic_mean, 4)}</td>
      <td class="${cls(s.icir)}">${Math.abs(s.icir) >= 0.5 ? '<span class="good">' : ''}${fmt(s.icir)}${Math.abs(s.icir) >= 0.5 ? '</span>' : ''}</td>
      <td>${fmt((s.win_rate || 0) * 100, 1)}%</td>
      <td>${fmt(s.t_stat, 2)}</td>
      <td>${fmt((s.ic_gt_002 || 0) * 100, 1)}%</td>
      <td class="${cls(s.recent_mean)}">${fmt(s.recent_mean, 4)}</td>
      ${deltaCell(s.wow, s.last_date)}
      ${deltaCell(s.mom, s.last_date)}
      <td class="${cls(ns.ic_mean)} sep">${fmt(ns.ic_mean, 4)}</td>
      <td class="${cls(ns.icir)}">${fmt(ns.icir)}</td>
      ${keepCell(r)}
      ${crowdCell(r.crowd)}
      <td style="text-align:left;color:var(--dim);font-size:11.5px;max-width:220px;white-space:normal">${r.desc}</td>`;
    tr.onclick = () => selectFactor(r.code);
    tb.appendChild(tr);
  }
  document.querySelectorAll('#tbl thead th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      if (!k) return;
      if (sortKey === k) sortAsc = !sortAsc; else { sortKey = k; sortAsc = false; }
      renderTable();
    };
  });
}

function selectFactor(code) {
  curFactor = code;
  const meta = SUMMARY.factors.find(f => f.code === code);
  const hn = { 1: '未来1日', 5: '未来5日', 20: '未来20日' }[curH];
  const _ser = (EFF[code] && EFF[code]['ic_series_' + curH]) || [];
  const _end = _ser.length ? _ser[_ser.length - 1].d : '';
  $('#icTitle').textContent = `IC 时间序列 — ${meta.name}（${hn}口径 · 曲线右端即最新可算日 ${_end}，蓝线=20日均线）`;
  $('#moTitle').textContent = `月度 IC 均值 — ${meta.name}（${hn}口径）`;
  $('#qTitle').textContent = `五分组累计净值 — ${meta.name}（${meta.category_name}）`;
  renderTable();
  const e = EFF[code];
  if (!e) return;
  // IC 曲线（随主口径切换）
  const pts = e['ic_series_' + curH] || [];
  const win = 20;
  const ma = pts.map((p, i) => {
    if (i < win - 1) return [p.d, null];
    let sum = 0; for (let j = i - win + 1; j <= i; j++) sum += pts[j].ic;
    return [p.d, +(sum / win).toFixed(4)];
  });
  icChart.setOption({
    ...base,
    xAxis: { type: 'category', data: pts.map(p => p.d), ...AX },
    yAxis: { type: 'value', ...AX, splitLine: { lineStyle: { color: '#232c45' } } },
    series: [
      { name: '日IC', type: 'bar', data: pts.map(p => p.ic), barMaxWidth: 5,
        itemStyle: { color: p => p.value >= 0 ? '#c25656' : '#3ecf8e' } },
      { name: '20日均线', type: 'line', data: ma, showSymbol: false, lineStyle: { color: '#5b8cff', width: 2 } }
    ]
  }, true);
  // 月度IC
  const mo = e['monthly_' + curH] || [];
  moChart.setOption({
    ...base, legend: { show: false },
    xAxis: { type: 'category', data: mo.map(m => m.month.slice(2)), ...AX },
    yAxis: { type: 'value', ...AX, splitLine: { lineStyle: { color: '#232c45' } } },
    series: [{ type: 'bar', data: mo.map(m => m.ic), barMaxWidth: 26,
      itemStyle: { color: p => p.value >= 0 ? '#c25656' : '#3ecf8e' },
      label: { show: true, position: 'outside', color: '#8b95b5', fontSize: 10, formatter: p => p.value.toFixed(3) } }]
  }, true);
  // 分组净值
  const q = e.quantile || {};
  const names = { Q1: '第1组(低值)', Q2: '第2组', Q3: '第3组', Q4: '第4组', Q5: '第5组(高值)', long_short: '多空(1-5组)' };
  const colors = { Q1: '#3ecf8e', Q2: '#7fb069', Q3: '#8b95b5', Q4: '#d9a05b', Q5: '#c25656', long_short: '#5b8cff' };
  const xq = (q.Q1 && q.Q1.length ? q.Q1 : (q.long_short || [])).map(p => p.d);
  const series = Object.keys(names).filter(k => q[k] && q[k].length).map(k => ({
    name: names[k], type: 'line', showSymbol: false,
    data: q[k].map(p => [p.d, p.v]),
    lineStyle: { width: k === 'long_short' ? 2.5 : 1.5 },
    itemStyle: { color: colors[k] }
  }));
  qChart.setOption({
    ...base,
    xAxis: { type: 'category', data: xq, ...AX },
    yAxis: { type: 'value', ...AX, scale: true, splitLine: { lineStyle: { color: '#232c45' } } },
    series
  }, true);
}

/* 拥挤度 × IC月环比 四象限：右上=拥挤且仍在增强，右下=拥挤且衰减（最危险） */
function renderQuad() {
  if (!quadChart || !SUMMARY) return;
  const catColor = { price_volume: '#5b8cff', valuation: '#3ecf8e', quality_growth: '#d9a05b' };
  const pts = [];
  for (const r of SUMMARY.factors) {
    if (!r.has_data || !r.crowd || r.crowd.score === null) continue;
    const s = (r.stats_h || {})[curH] || {};
    const ns = (r.nstats_h || {})[curH] || {};
    if (!s.mom) continue;
    pts.push({
      value: [r.crowd.score, s.mom.delta, Math.min(28, 6 + Math.abs(ns.icir || s.icir || 0) * 12)],
      name: r.name, cat: r.category, code: r.code, icir: ns.icir ?? s.icir,
      itemStyle: { color: catColor[r.category], opacity: .85 },
      crowd: r.crowd
    });
  }
  quadChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { formatter: p => {
      const d = p.data;
      return `<b>${d.name}</b><br/>拥挤度 ${d.value[0]}（${d.crowd.long_side}为多头）<br/>月环比IC ${d.value[1]>0?'+':''}${d.value[1].toFixed(4)}<br/>中性ICIR ${d.icir===null?'-':(+d.icir).toFixed(2)}<br/>四维分位 定价${d.crowd.rank.valuation} 资金${d.crowd.rank.money} 关注${d.crowd.rank.attention} 风险${d.crowd.rank.risk}`;
    } },
    grid: { left: 55, right: 25, top: 30, bottom: 45 },
    xAxis: { name: '拥挤度', min: 0, max: 100, ...AX, splitLine: { lineStyle: { color: '#232c45' } } },
    yAxis: { name: 'IC月环比', ...AX, splitLine: { lineStyle: { color: '#232c45' } } },
    series: [{
      type: 'scatter', symbolSize: v => v[2], data: pts,
      markLine: { silent: true, symbol: 'none', lineStyle: { color: '#8b95b5', type: 'dashed' },
        data: [{ xAxis: 60 }, { yAxis: 0 }],
        label: { color: '#8b95b5', fontSize: 10, formatter: p => p.name || '' } }
    }]
  }, true);
}

// 分类 tab
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    curCat = b.dataset.cat;
    renderTable();
  };
});

// IC 周期切换
$('#hSel').onchange = () => {
  curH = +$('#hSel').value;
  updateCut();
  renderTable();
  renderQuad();
  if (curFactor) selectFactor(curFactor);
};

async function triggerUpdate() {
  const btn = $('#updBtn'), st = $('#updState');
  btn.disabled = true;
  try {
    const r = await fetch('/api/update', { method: 'POST' }).then(x => x.json());
    st.textContent = r.msg || '更新中…';
    st.className = 'state';
    poll();
  } catch { st.textContent = '启动失败'; st.className = 'state err'; btn.disabled = false; }
}
function poll() {
  const t = setInterval(async () => {
    const s = await fetch('api/status.json').then(r => r.json()).catch(() => ({}));
    const st = $('#updState');
    if (s.state === 'running') { st.textContent = '更新中…'; st.className = 'state'; }
    else if (s.state === 'ok') {
      st.textContent = '更新完成'; st.className = 'state ok';
      $('#updBtn').disabled = false; clearInterval(t);
      const [sm, ef] = await Promise.all([fetch('api/summary.json').then(r => r.json()), fetch('api/eff.json').then(r => r.json())]);
      SUMMARY = sm; EFF = ef;
      updateCut();
      renderQuad();
      $('#uniN').textContent = sm.universe_n; $('#updatedAt').textContent = sm.updated_at;
      renderTable();
    } else if (s.state === 'error') {
      st.textContent = '更新失败'; st.className = 'state err';
      $('#updBtn').disabled = false; clearInterval(t);
    } else { $('#updBtn').disabled = false; clearInterval(t); }
  }, 5000);
}

boot();
