/* 因子适用域（多因子条件）页面逻辑 */
const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
let D = null, barChart, scatter, mode = 'stable';
const CAT_COLOR = { price_volume: '#5b8cff', valuation: '#3ecf8e', quality_growth: '#d9a05b' };
const AX = { axisLine: { lineStyle: { color: '#2a3450' } }, axisLabel: { color: '#8b95b5', fontSize: 11 } };

function cellKey(c, t) { return c + '|' + t; }
function pick() {
  return D.cells.filter(x => mode === 'all' ? true : x.stable);
}
function fmt4(v) { return (v === null || v === undefined) ? '-' : (v > 0 ? '+' : '') + (+v).toFixed(4); }

function renderHead() {
  $('#asOf').textContent = D.as_of || '-';
  $('#genAt').textContent = D.generated_at || '-';
  $('#nFdr').textContent = D.n_fdr;
  $('#sameRate').textContent = ((D.same_sign_rate || 0) * 100).toFixed(0) + '%';
  const cross = D.cells.filter(x => x.stable && x.axis === '跨轴').length;
  $('#credNote').innerHTML =
    `<b>可信度提示：</b>本页对 ${D.n_tests} 个有序配对做了「前后半样本复现」检验。` +
    `通过 FDR(q&lt;0.10) 的有 ${D.n_fdr} 对，但两半同号率只有 ${((D.same_sign_rate || 0) * 100).toFixed(0)}%——` +
    `因此<b>只把复现成功的 ${D.n_stable} 对（其中跨轴 ${cross} 对）视为可用结论</b>，其余仅作对照展示。`;
  const st = D.cells.filter(x => x.stable);
  const byC = {}, byAxis = {};
  st.forEach(x => {
    byC[x.c] = (byC[x.c] || 0) + 1;
    const k = x.axis_c + '→' + x.axis_t;
    byAxis[k] = (byAxis[k] || 0) + 1;
  });
  const hot = Object.entries(byC).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => `<b>${esc(D.labels[D.names.indexOf(k)])}</b>（作为分池条件影响 ${n} 个因子）`);
  const axLine = Object.entries(byAxis).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => `${esc(k.split('→')[0])} 池内看 ${esc(k.split('→')[1])}（${n}对）`);
  const topCross = D.cells.filter(x => x.stable && x.axis === '跨轴')
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const crossTxt = topCross
    ? `最强的跨轴条件：<b>${esc(topCross.c_name)}</b> 分池时，<b>${esc(topCross.t_name)}</b> 在高值池 IC ${fmt4(topCross.ic_hi)}、` +
      `低值池 IC ${fmt4(topCross.ic_lo)}（ΔIC ${fmt4(topCross.delta)}，前后半 t=${topCross.t_h1}/${topCross.t_h2}）。`
    : '';
  $('#summaryLine').innerHTML =
    `<div class="lede"><b>本期条件结构（截至 ${esc(D.as_of || '-')}，随每日更新重算）：</b>` +
    `共 ${st.length} 对条件效应通过样本外复现，其中跨轴 ${D.cells.filter(x => x.stable && x.axis === '跨轴').length} 对。` +
    `条件效应最集中的分池维度：${hot.join('、') || '-'}。</div>` +
    (axLine.length ? `<div class="lede2">按风格轴看：${axLine.join('；')}。</div>` : '') +
    (crossTxt ? `<div class="lede2">${crossTxt}</div>` : '') +
    `<div class="lede2" style="color:var(--dim);font-size:11.5px">本页只描述结构差异，不判断方向好坏；ΔIC 的正负需结合该因子自身IC方向一起读（见单因子页）。</div>`;
}

function renderCards() {
  $('#cards').innerHTML = (D.cards || []).map(c => `
    <div class="carditem ${c.axis === '跨轴' ? 'cross' : 'same'}">
      <div class="ctitle">${esc(c.title)} <span class="axtag">${esc(c.axis)}</span></div>
      <div class="ctext">${esc(c.text)}</div>
      <div class="cnote">${esc(c.note)}</div>
    </div>`).join('') || '<div class="qsub">当前无满足稳定判据的配对。</div>';
}

function renderMatrix() {
  const names = D.names, L = D.labels, n = names.length;
  const map = {};
  D.cells.forEach(x => { map[cellKey(x.c, x.t)] = x; });
  const shown = pick();
  const ok = {};
  shown.forEach(x => { ok[cellKey(x.c, x.t)] = 1; });
  let h = '<table class="mx"><tr><th></th>' + L.map(t => `<th title="${esc(t)}">${esc(t.slice(0, 5))}</th>`).join('') + '</tr>';
  for (let i = 0; i < n; i++) {
    h += `<tr><th>${esc(L[i])}</th>`;
    for (let j = 0; j < n; j++) {
      if (i === j) { h += '<td class="diag">—</td>'; continue; }
      const x = map[cellKey(names[i], names[j])];
      if (!x) { h += '<td class="none"></td>'; continue; }
      if (!ok[cellKey(names[i], names[j])]) { h += `<td class="dim" title="${esc(x.c_name)} 池内 ${esc(x.t_name)}：ΔIC ${fmt4(x.delta)}（样本外未复现 t=${x.t_full}）"></td>`; continue; }
      const v = x.delta;
      const a = Math.min(1, Math.abs(v) / 0.10);
      const bg = v >= 0 ? `rgba(224,92,92,${0.12 + a * 0.7})` : `rgba(62,207,142,${0.12 + a * 0.7})`;
      h += `<td style="background:${bg}" data-c="${x.c}" data-t="${x.t}"
             title="${esc(x.c_name)} 池内 → ${esc(x.t_name)}｜ΔIC ${fmt4(v)}｜高池 ${fmt4(x.ic_hi)} 低池 ${fmt4(x.ic_lo)}｜t=${x.t_full} q=${x.q}｜${x.axis}">
             ${v.toFixed(3).replace('0.', '.')}</td>`;
    }
    h += '</tr>';
  }
  h += '</table>';
  const el = $('#matrix');
  el.innerHTML = h;
  el.querySelectorAll('td[data-c]').forEach(td => {
    td.onclick = () => showDetail(td.dataset.c, td.dataset.t);
  });
}

function showDetail(c, t) {
  const x = D.cells.find(v => v.c === c && v.t === t);
  if (!x) return;
  $('#barTitle').textContent = `${x.c_name} 分池内 → ${x.t_name} 的IC（未来${D.horizon}日）`;
  $('#barHint').innerHTML = `条件池规模：低档约 ${x.n_lo} 只 / 高档约 ${x.n_hi} 只 ｜ ΔIC ${fmt4(x.delta)}
    ｜ 前半 ΔIC ${fmt4(x.delta_h1)}(t=${x.t_h1}) ／ 后半 ${fmt4(x.delta_h2)}(t=${x.t_h2}) ｜ q=${x.q} ｜ ${x.axis}
    ｜ ${x.stable ? '<span class="badge ok">样本外已复现</span>' : '<span class="badge bad">样本外未复现，勿采信</span>'}`;
  barChart.setOption({
    backgroundColor: 'transparent',
    grid: { left: 55, right: 20, top: 24, bottom: 30 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ['低档池', '中档池', '高档池'], ...AX },
    yAxis: { type: 'value', ...AX, splitLine: { lineStyle: { color: '#232c45' } } },
    series: [{ type: 'bar', data: [x.ic_lo, x.ic_mid, x.ic_hi].map(v => ({
        value: v, itemStyle: { color: v >= 0 ? '#c25656' : '#3ecf8e' } })),
      barMaxWidth: 60, label: { show: true, position: 'top', color: '#8b95b5', fontSize: 11,
        formatter: p => p.value === null ? '-' : p.value.toFixed(4) } }]
  }, true);
}

function renderScatter() {
  const pts = D.cells.map(x => ({
    value: [x.delta_h1, x.delta_h2], x,
    itemStyle: { color: x.stable ? (x.axis === '跨轴' ? '#ffd479' : '#5b8cff') : 'rgba(139,149,181,.28)',
                 opacity: x.stable ? .95 : .45 },
    symbolSize: x.stable ? 9 : 5
  }));
  scatter.setOption({
    backgroundColor: 'transparent',
    grid: { left: 55, right: 20, top: 24, bottom: 40 },
    tooltip: { formatter: p => `${p.data.x.c_name} → ${p.data.x.t_name}<br/>前半 ΔIC ${fmt4(p.data.x.delta_h1)} (t=${p.data.x.t_h1})<br/>后半 ΔIC ${fmt4(p.data.x.delta_h2)} (t=${p.data.x.t_h2})<br/>${p.data.x.stable ? '两半同号且显著 → 可用' : '未同时满足 → 噪声'}` },
    xAxis: { type: 'value', name: '前半ΔIC', ...AX, splitLine: { lineStyle: { color: '#232c45' } } },
    yAxis: { type: 'value', name: '后半ΔIC', ...AX, splitLine: { lineStyle: { color: '#232c45' } } },
    series: [{ type: 'scatter', data: pts,
      markLine: { silent: true, symbol: 'none', lineStyle: { color: '#8b95b5', type: 'dashed' }, data: [{ xAxis: 0 }, { yAxis: 0 }] } }]
  }, true);
}

document.querySelectorAll('input[name=mk]').forEach(r => {
  r.onchange = () => { mode = r.value; renderMatrix(); };
});

(async function () {
  barChart = echarts.init($('#barChart'));
  scatter = echarts.init($('#scatter'));
  window.addEventListener('resize', () => { barChart.resize(); scatter.resize(); });
  try {
    D = await fetch('api/cond.json').then(r => r.json());
  } catch (e) { $('#credNote').textContent = '条件数据加载失败：' + e; return; }
  if (!D || !D.cells) { $('#credNote').textContent = '暂无条件IC数据（请先运行 update.py 或 python cond.py）'; return; }
  renderHead(); renderCards(); renderMatrix(); renderScatter();
  const best = D.cells.filter(x => x.stable).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  if (best) showDetail(best.c, best.t);
})();
