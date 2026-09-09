/* A股量化因子有效性看板 前端逻辑 */
let SUMMARY = null, EFF = null;
let curCat = 'all', curFactor = null, sortKey = 'icir', sortAsc = false, curH = 20;
let icChart, moChart, qChart;

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
  window.addEventListener('resize', () => { icChart.resize(); moChart.resize(); qChart.resize(); });
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
  renderTable();
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
    if (k === 'last_ic') return r.last_ic ?? -9;
    const s = (r.stats_h || {})[curH];
    return s ? s[k] : -9;
  };
  return rowsData().slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    const c = typeof va === 'string' ? va.localeCompare(vb) : (va - vb);
    return sortAsc ? c : -c;
  });
}

function renderTable() {
  const tb = $('#tbl tbody');
  tb.innerHTML = '';
  for (const r of sortedRows()) {
    const s = (r.stats_h || {})[curH] || {};
    const tr = document.createElement('tr');
    if (r.code === curFactor) tr.classList.add('sel');
    tr.innerHTML = `
      <td><span class="catLabel">${r.category_name}</span><span class="fname">${r.name}</span><span class="fcode">${r.code}</span></td>
      <td class="${cls(r.last_ic)}">${fmt(r.last_ic, 4)}</td>
      <td class="${cls(s.ic_mean)}">${fmt(s.ic_mean, 4)}</td>
      <td class="${cls(s.icir)}">${Math.abs(s.icir) >= 0.5 ? '<span class="good">' : ''}${fmt(s.icir)}${Math.abs(s.icir) >= 0.5 ? '</span>' : ''}</td>
      <td>${fmt((s.win_rate || 0) * 100, 1)}%</td>
      <td>${fmt(s.t_stat, 2)}</td>
      <td>${fmt((s.ic_gt_002 || 0) * 100, 1)}%</td>
      <td class="${cls(s.recent_mean)}">${fmt(s.recent_mean, 4)}</td>
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
  $('#icTitle').textContent = `IC 时间序列 — ${meta.name}（${hn}收益口径，蓝线=20日均线）`;
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
  renderTable();
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
      $('#uniN').textContent = sm.universe_n; $('#updatedAt').textContent = sm.updated_at;
      renderTable();
    } else if (s.state === 'error') {
      st.textContent = '更新失败'; st.className = 'state err';
      $('#updBtn').disabled = false; clearInterval(t);
    } else { $('#updBtn').disabled = false; clearInterval(t); }
  }, 5000);
}

boot();
