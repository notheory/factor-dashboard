/* 数据校验页逻辑 */
const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
let FACTORS = [], DATES = [];

async function boot() {
  const s = await fetch('api/summary.json').then(r => r.json()).catch(() => null);
  if (!s) { $('#hint').textContent = 'summary 加载失败'; return; }
  FACTORS = s.factors.filter(f => f.has_data);
  DATES = (s.dates || []).slice().reverse(); // 最新在前
  $('#fSel').innerHTML = FACTORS.map(f => `<option value="${f.code}">${f.name} (${f.code})</option>`).join('');
  $('#dSel').innerHTML = '<option value="">自动（最近可算IC日）</option>' +
    DATES.map(d => `<option value="${d}">${d}</option>`).join('');
}

function kv(pairs) {
  return '<div class="kv">' + pairs.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('') + '</div>';
}

async function run() {
  const factor = $('#fSel').value, date = $('#dSel').value,
        stock = $('#sInp').value.trim().toUpperCase(), h = $('#hSel2').value;
  $('#hint').textContent = '计算中…（首次加载因子面板约需数秒）';
  const q = `factor=${factor}&date=${date}&stock=${encodeURIComponent(stock)}&h=${h}`;
  let d;
  try {
    const r = await fetch('api/verify?' + q);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    d = await r.json();
  } catch (e) {
    $('#hint').innerHTML = '校验接口加载失败(' + esc(String(e)) + ')——请确认通过 <b>http://localhost:8082</b> 访问本地版，' +
      '并重启服务（双击 启动看板.bat）后按 Ctrl+F5 刷新；静态发布版不支持实时校验。';
    return;
  }
  if (d.error) { $('#hint').textContent = '错误: ' + d.error; return; }
  $('#hint').textContent = d.note || '';
  $('#csvLink').style.display = '';
  $('#csvLink').href = `api/verify.csv?${q}`;

  // ① 单票重算
  const badge = d.match ? '<span class="badge ok">一致 ✓</span>' : '<span class="badge bad">不一致 ✗</span>';
  let s1 = `<p><b>${esc(d.factor_name)}</b> @ ${esc(d.stock)} ${esc(d.stock_name)} · ${esc(d.date)}</p>
    <p>公式：<code>${esc(d.formula)}</code> <span class="state">（${esc(d.formula_note || '')}）</span></p>`;
  if (d.steps) s1 += kv(d.steps.map(([k, v]) => [k, typeof v === 'number' ? (+v).toPrecision(8) : v]));
  if (d.manual_value !== undefined && d.manual_value !== null) {
    s1 += `<p>手工值 = <b>${d.manual_value}</b> ｜ 引擎值 = <b>${d.engine_value}</b> ${badge}</p>`;
  } else if (d.steps_error) {
    s1 += `<p class="badge bad">重算异常: ${esc(d.steps_error)}</p>`;
  } else {
    s1 += `<p class="state">该股票当日无值（停牌/数据缺失），可在截面②中任选一只填入示例股票框重试。</p>`;
  }
  s1 += `<p class="state">因子说明：${esc(d.desc)}</p>`;
  $('#step1').innerHTML = s1;
  $('#step1').classList.remove('note');

  // ② 截面分布
  const st = d.xsec_stats;
  let s2 = `<p>有效样本 <b>${d.xsec_n}</b> 只</p>` +
    kv([['均值', st.mean], ['中位数', st.median], ['标准差', st.std], ['最小值', st.min], ['最大值', st.max]]);
  const tb = arr => arr.map(r => `<tr><td>${esc(r.stock)}</td><td>${esc(r.name)}</td><td>${(+r.value).toPrecision(6)}</td></tr>`).join('');
  s2 += `<p style="margin-top:8px"><b>因子值最大10只</b></p><table class="icTable"><tbody>${tb(d.top10)}</tbody></table>
         <p style="margin-top:8px"><b>因子值最小10只</b></p><table class="icTable"><tbody>${tb(d.bottom10)}</tbody></table>`;
  $('#step2').innerHTML = s2;
  $('#step2').classList.remove('note');

  // ③ IC 过程
  const ic = d.ic;
  const icv = (ic.ic === null || ic.ic === undefined) ? '-' : ic.ic;
  const selfB = ic.self_consistent ? '<span class="badge ok">与eff.json一致 ✓</span>'
    : (ic.self_consistent === false && ic.n > 0 ? '<span class="badge bad">与eff.json不一致 ✗</span>' : '');
  $('#step3').innerHTML = `<p>样本 <b>${ic.n}</b> 只 ${ic.enough_stocks ? '' : '<span class="badge bad">低于300，未计入IC</span>'} ｜
    Σd² = <b>${ic.sum_d2 ?? '-'}</b> ｜ Spearman IC = <b>${icv}</b> ${selfB}
    ｜ eff.json 该日IC = ${ic.eff_json_value ?? '-'}
    ${ic.n === 0 ? '<p class="badge bad">该日期之后不足' + d.horizon + '个交易日，未来收益尚未产生，无法计算IC——请选择更早的交易日（或用"自动"）。</p>' : ''}</p>
    <p class="state">下表展示按因子值降序前25只，全量${ic.n}只请点击上方"下载全截面CSV"（可用Excel自行验算排名与相关系数）。</p>`;
  $('#icTbl tbody').innerHTML = d.ic_rows.map(r =>
    `<tr><td>${esc(r.stock)}</td><td>${esc(r.name)}</td><td>${(+r.f).toPrecision(6)}</td><td>${r.rk_f}</td>
     <td>${r.ret}</td><td>${r.rk_r}</td><td>${(+r.d).toFixed(1)}</td><td>${(r.d * r.d).toFixed(1)}</td></tr>`).join('');
}

boot();
