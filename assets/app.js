(() => {
'use strict';

const CONFIG = {
  projectStart: '2025-07-01',   // M1 = luglio 2025 (dallo schedule: M12 = 30/06/2026)
  months: 30,
  secondsPerDay: 120,           // 1 giorno simulato in circa 2 minuti a velocità 1x
  lsKey: 'flexidata.lang',
  atlas: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json'
};
const C = { navy:'#0A1C32', green:'#10A060', deep:'#1E7F5C', neon:'#34D98E', sage:'#88ADA7', amber:'#E39B2E',
  amberSoft:'rgba(227,155,46,.15)', amberWin:'rgba(227,155,46,.36)', req:'#A55F00', gray:'#8B98A5', grid:'#E4EAEF', text:'#44566A', red:'#B8342B' };
const NODES = ['MI','RM','NA','N4'];
const LEVERS = [['spatial','leva_spostamento_spaziale_kw','sim.flex.series.lever_spatial',C.navy],
                ['temporal','leva_differimento_it_kw','sim.flex.series.lever_temporal',C.sage],
                ['hvac','leva_climatizzazione_kw','sim.flex.series.lever_hvac',C.green]];
const CFGS = ['stato_attuale','fv','fv_accumulo_autoconsumo','fv_accumulo_riduzione_picchi'];
const STRATS = ['autoconsumo','riduzione_picchi','fasce','riserva'];
const STRAT_CFG = { autoconsumo:'fv_accumulo_autoconsumo', riduzione_picchi:'fv_accumulo_riduzione_picchi' };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, html) => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; };
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

/* ---------- state ---------- */
const D = {};
let DATA, F, E, EVENTS = [], TRANSFER = [];
const S = { lang:'it', mode:'flex', node:'MI', idx:0, lastI:-1, playing:!reduced, speed:1,
  levers:{ spatial:true, temporal:true, hvac:true }, cfg:'fv_accumulo_riduzione_picchi', strat:'riduzione_picchi',
  kpiDay:3, bridge:false, reserve:30, capexPv:1000, capexBess:450, dismissed:null, chartDirty:true };
const vis = { hero:false, architecture:false, simulator:false, map:false, objectives:false, consortium:false };

/* ---------- i18n ---------- */
const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
function t(k, args) {
  let s = get(D[S.lang], k);
  if (typeof s !== 'string') s = get(D.it, k);
  if (typeof s !== 'string') { console.warn('[i18n] missing', k); return ''; }
  return args ? s.replace(/\{(\w+)\}/g, (m, p) => (args[p] != null ? args[p] : m)) : s;
}
function translate(root = document) {
  const scope = root.querySelectorAll ? root : document;
  const nodes = [...scope.querySelectorAll('[data-i18n]')];
  if (root.dataset && root.dataset.i18n) nodes.push(root);
  nodes.forEach(n => {
    const args = n.dataset.i18nArgs ? JSON.parse(n.dataset.i18nArgs) : null;
    const v = t(n.dataset.i18n, args);
    if (n.textContent !== v) n.textContent = v;
  });
  scope.querySelectorAll('[data-i18n-attr]').forEach(n => {
    n.dataset.i18nAttr.split(';').forEach(pair => {
      const [a, k] = pair.split(':').map(x => x.trim());
      if (a && k) n.setAttribute(a, t(k));
    });
  });
}
const i18nSpan = (key, args, cls) => `<span${cls ? ` class="${cls}"` : ''} data-i18n="${key}"${args ? ` data-i18n-args='${esc(JSON.stringify(args))}'` : ''}></span>`;

const locale = () => (S.lang === 'it' ? 'it-IT' : 'en-GB');
const _nf = {};
function fmt(v, d = 0, extra) {
  if (v == null || Number.isNaN(v)) return '—';
  const key = locale() + d + JSON.stringify(extra || {});
  _nf[key] = _nf[key] || new Intl.NumberFormat(locale(), { minimumFractionDigits:d, maximumFractionDigits:d, ...(extra || {}) });
  return _nf[key].format(v);
}
const pct = (v, d = 0, extra) => fmt(v, d, { style:'percent', ...(extra || {}) });
const _tf = {};
function time(ts) {
  const k = locale();
  _tf[k] = _tf[k] || new Intl.DateTimeFormat(k, { hour:'2-digit', minute:'2-digit', hourCycle:'h23', timeZone:'UTC' });
  return _tf[k].format(new Date(ts + ':00Z'));
}

function pickLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'it' || q === 'en') return q;
  try { const s = localStorage.getItem(CONFIG.lsKey); if (s === 'it' || s === 'en') return s; } catch (e) {}
  const nav = (navigator.languages || [navigator.language || 'it']).map(l => l.toLowerCase());
  for (const l of nav) { if (l.startsWith('it')) return 'it'; if (l.startsWith('en')) return 'en'; }
  return 'it';
}
function setLang(l) {
  S.lang = l;
  try { localStorage.setItem(CONFIG.lsKey, l); } catch (e) {}
  document.documentElement.lang = l;
  document.title = t('meta.title');
  $('meta[name="description"]').setAttribute('content', t('meta.description'));
  $$('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  translate();
  refreshDynamic();
}

/* ---------- data ---------- */
async function loadJSON(url, embedId, embedKey) {
  const emb = document.getElementById(embedId);
  if (emb && emb.textContent.trim()) return JSON.parse(emb.textContent);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return await r.json();
  } catch (err) {
    const bag = window.__FLEX_EMBED__;
    if (bag && embedKey && bag[embedKey]) return bag[embedKey];
    throw err;
  }
}
let T0 = 0;
const idxOf = ts => Math.round((Date.parse(ts + ':00Z') - T0) / 900000);

function prepData() {
  F = DATA.flessibilita.serie; E = DATA.efficientamento;
  T0 = Date.parse(F.timestamp[0] + ':00Z');
  EVENTS = DATA.flessibilita.eventi.map(e => ({ ...e, n:idxOf(e.notifica), s:idxOf(e.inizio), f:idxOf(e.fine) }));
  TRANSFER = new Array(288).fill(0);
  F.trasferimento_mappa.forEach(tr => { TRANSFER[idxOf(tr.t)] = tr.kw_it; });
  // stable scales per node
  S.range = {};
  NODES.forEach(n => {
    const arrs = [F[n].baseline_kw, F[n].misurato_pod_kw].filter(Boolean);
    let lo = Infinity, hi = -Infinity;
    arrs.forEach(a => a.forEach(v => { if (v < lo) lo = v; if (v > hi) hi = v; }));
    const pad = (hi - lo) * 0.08; S.range[n] = [lo - pad, hi + pad];
  });
  let lo = 0, hi = 0;
  for (let i = 0; i < 288; i++) {
    let p = 0, m = 0;
    LEVERS.forEach(([, k]) => { const v = F.MI[k][i]; if (v > 0) p += v; else m += v; });
    hi = Math.max(hi, p, F.richiesta_kw[i]); lo = Math.min(lo, m);
  }
  S.leverRange = [lo * 1.15, hi * 1.12];
  S.recvMax = Math.max(...F.RM.carico_ricevuto_kw) * 1.2 || 10;
}

function phaseAt(i) {
  for (const ev of EVENTS) {
    if (i >= ev.n && i < ev.s) return { ev, phase:'notice' };
    if (i >= ev.s && i < ev.f) return { ev, phase:'window' };
  }
  let last = null;
  for (const ev of EVENTS) if (i >= ev.f) last = ev;
  return last ? { ev:last, phase:'after' } : { ev:null, phase:null };
}

/* ---------- visibility & loop ---------- */
function observe() {
  const io = new IntersectionObserver(es => es.forEach(e => {
    const k = e.target.id === 'top' ? 'hero' : e.target.id;
    vis[k] = e.isIntersecting;
    if (k === 'simulator' && e.isIntersecting) { S.chartDirty = true; drawChart(); }
    if (k === 'objectives' && e.isIntersecting) startCounters();
  }), { threshold:0.05 });
  ['top','architecture','simulator','map','objectives','consortium'].forEach(id => io.observe(document.getElementById(id)));
  const links = $$('.nav a');
  const io2 = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) links.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin:'-45% 0px -50% 0px' });
  links.forEach(a => { const s = document.querySelector(a.getAttribute('href')); if (s) io2.observe(s); });
}
let lastTs = 0;
function frame(ts) {
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0; lastTs = ts;
  const simOn = vis.simulator || vis.map;
  if (S.playing && simOn && S.mode === 'flex') {
    S.idx += dt * (96 / CONFIG.secondsPerDay) * S.speed;
    if (S.idx >= 288) S.idx -= 288;
    S.chartDirty = true;
  }
  const i = Math.floor(S.idx);
  if (i !== S.lastI) { S.lastI = i; onInterval(); }
  if (vis.simulator && S.chartDirty) { drawChart(); S.chartDirty = false; }
  if (vis.map) mapFrame(ts, dt);
  if (vis.hero && !reduced) heroFrame(ts);
  if (vis.architecture && !reduced) archFrame(ts);
  requestAnimationFrame(frame);
}

/* ---------- simulator: UI ---------- */
function buildSimUI() {
  $$('#modeSeg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const ns = $('#nodeSeg');
  NODES.forEach(n => {
    const b = el('button', { type:'button', role:'radio', 'data-node':n }, i18nSpan('map.nodes.' + n));
    b.addEventListener('click', () => setNode(n)); ns.appendChild(b);
  });
  const sp = $('#speedSeg');
  [1, 5, 20].forEach(v => {
    const b = el('button', { type:'button', role:'radio', 'data-speed':v, class:'mono' }, i18nSpan('sim.speed_x', { n:v }));
    b.addEventListener('click', () => { S.speed = v; syncControls(); }); sp.appendChild(b);
  });
  $('#playBtn').addEventListener('click', () => { S.playing = !S.playing; syncControls(); });
  $('#restartBtn').addEventListener('click', () => { S.idx = 0; S.dismissed = null; S.chartDirty = true; S.lastI = -1; });
  buildFlexCharts();
  const lc = $('#leverChecks');
  LEVERS.forEach(([k, , key, col]) => {
    const l = el('label', { class:'check' }, `<input type="checkbox" checked data-lever="${k}"><i style="background:${col}"></i>${i18nSpan(key)}`);
    l.querySelector('input').addEventListener('change', e => { S.levers[k] = e.target.checked; S.chartDirty = true; renderLegend(); });
    lc.appendChild(l);
  });
  const cs = $('#cfgSeg');
  CFGS.forEach(c => {
    const b = el('button', { type:'button', role:'radio', 'data-cfg':c }, `${cfgGlyph(c)}<span class="cfg-card__txt">${i18nSpan('sim.eff.configs.' + c)}</span>`);
    b.addEventListener('click', () => setCfg(c)); cs.appendChild(b);
  });
  const sr = $('#stratRadios');
  STRATS.forEach(s => {
    const l = el('label', { class:'radio' }, `<input type="radio" name="strat" value="${s}">${i18nSpan('sim.eff.strategies.' + s)}`);
    l.querySelector('input').addEventListener('change', () => setStrat(s)); sr.appendChild(l);
  });
  $('#bridgeToggle').addEventListener('change', e => { S.bridge = e.target.checked; syncControls(); });
  $('#reserveRange').addEventListener('input', e => { S.reserve = +e.target.value; renderBridge(); });
  $('#capexPv').addEventListener('input', e => { S.capexPv = Math.max(0, +e.target.value || 0); renderEcon(); });
  $('#capexBess').addEventListener('input', e => { S.capexBess = Math.max(0, +e.target.value || 0); renderEcon(); });
  // arrow keys inside radiogroups
  $$('[role="radiogroup"].seg, #cfgSeg').forEach(g => g.addEventListener('keydown', e => {
    if (!['ArrowLeft','ArrowRight'].includes(e.key)) return;
    const bs = $$('button', g); const i = bs.indexOf(document.activeElement); if (i < 0) return;
    const n = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length]; n.focus(); n.click(); e.preventDefault();
  }));
  if (reduced) { $('#rmNote').hidden = false; S.idx = 287.999; }
  const ro = new ResizeObserver(() => { sizeCanvas(); S.chartDirty = true; drawChart(); });
  ro.observe($('#flexStack'));
  ro.observe($('#effChart .chart-wrap'));
}
function buildFlexCharts() {
  const box = $('#flexCharts');
  NODES.forEach(n => {
    const low = n === 'MI' || n === 'RM';
    const card = el('article', { class:'chart-card chart-card--node' + (low ? ' is-low' : ''), 'data-node':n });
    card.innerHTML = `<div class="chart-head"><h3 class="chart-card__title">${i18nSpan('map.nodes.' + n)}</h3></div>
      <div class="chart-wrap chart-wrap--node"><canvas data-node="${n}" role="img" data-i18n-attr="aria-label:a11y.chart"></canvas></div>
      <div class="legend" data-legend="${n}"></div>`;
    card.addEventListener('click', () => setNode(n));
    box.appendChild(card);
  });
}

function setMode(m) {
  if (m === S.mode) return;
  const sim = $('#sim'); sim.classList.add('is-switching');
  setTimeout(() => {
    S.mode = m; sim.dataset.mode = m; $('#mapBox').dataset.mode = m;
    syncControls(); renderLegend(); renderKPI(); renderMapMode(); onInterval();
    sizeCanvas(); S.chartDirty = true; drawChart();
    setTimeout(() => sim.classList.remove('is-switching'), 30);
  }, reduced ? 0 : 200);
}
function setNode(n) {
  S.node = n; syncControls(); renderLegend(); renderKPI(); renderMapSelection(); S.chartDirty = true; onInterval();
}
function setCfg(c) {
  S.cfg = c;
  const s = Object.keys(STRAT_CFG).find(k => STRAT_CFG[k] === c);
  S.strat = s || null; S.stratNA = false;
  syncControls(); renderLegend(); renderKPI(); S.chartDirty = true;
}
function setStrat(s) {
  S.strat = s;
  if (STRAT_CFG[s]) { S.cfg = STRAT_CFG[s]; S.stratNA = false; } else S.stratNA = true;
  syncControls(); renderLegend(); renderKPI(); S.chartDirty = true;
}

function syncControls() {
  $$('#modeSeg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === S.mode)));
  $$('#nodeSeg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.node === S.node)));
  $$('#speedSeg button').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.speed === S.speed)));
  $$('#cfgSeg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.cfg === S.cfg)));
  $$('#stratRadios input').forEach(i => { i.checked = i.value === S.strat; });
  const pb = $('#playBtn');
  pb.dataset.i18n = S.playing ? 'sim.pause' : 'sim.play';
  pb.classList.toggle('btn-ctl--play', !S.playing);
  pb.textContent = t(pb.dataset.i18n);
  $$('#leverChecks .check').forEach(l => {
    const dis = S.node !== 'MI'; l.classList.toggle('is-disabled', dis); l.querySelector('input').disabled = dis;
  });
  const nd = E.nodi[S.node], cfg = nd.configurazioni[S.cfg];
  $('#stratMsg').hidden = !S.stratNA;
  $('#bessIdle').hidden = !cfg.accumulo_inattivo;
  $('#sizes').textContent = t('sim.eff.sizes', { pv:fmt(nd.taglia.fv_kwp), kwh:fmt(nd.taglia.accumulo_kwh), kw:fmt(nd.taglia.accumulo_kw) });
  $('#bridgeBox').hidden = !S.bridge;
  const mv = $('#mapCfgVal'); if (mv) mv.textContent = t('sim.eff.configs.' + S.cfg);
  renderBridge(); renderEcon();
  if (S.mode === 'eff' && M.nodes) { renderEffIcons(); renderMapMode(); }
  $$('#flexCharts .chart-card--node').forEach(c => c.classList.toggle('is-sel', c.dataset.node === S.node));
}

function legendItem(sw, key, args, pre) {
  return `<span>${sw}${pre ? i18nSpan(pre, null, 'lbl-pre') : ''}${i18nSpan(key, args)}</span>`;
}
const SW = {
  line:(c, d) => `<svg width="22" height="10" aria-hidden="true"><path d="M1 5H21" stroke="${c}" stroke-width="2.5" ${d ? `stroke-dasharray="${d}"` : ''}/></svg>`,
  box:(c, b) => `<i style="background:${c};${b ? `border:1.5px solid ${b};` : ''}border-radius:2px"></i>`,
  down:c => `<svg width="14" height="14" aria-hidden="true"><path d="M1 4H13" stroke="${C.navy}" stroke-width="1"/><rect x="3" y="4" width="8" height="9" fill="${c}"/></svg>`
};
function flexLegendItems(n) {
  const L = [];
  if (F[n].baseline_kw) L.push(legendItem(SW.line(C.navy, '5 4'), 'sim.flex.series.baseline'));
  L.push(legendItem(SW.line(C.green), 'sim.flex.series.measured'));
  if (n === 'MI') {
    L.push(legendItem(SW.line(C.req, '2 3'), 'sim.flex.series.request'));
    LEVERS.forEach(([k, , key, col]) => { if (S.levers[k]) L.push(legendItem(SW.box(col), key)); });
    L.push(legendItem(SW.down(C.green), 'sim.flex.precooling'));
    L.push(legendItem(SW.down(C.sage), 'sim.flex.rebound'));
  }
  if (n === 'RM') L.push(legendItem(SW.box('rgba(136,173,167,.45)', C.deep), 'sim.flex.series.received'));
  L.push(legendItem(SW.box(C.amberSoft, C.amber), 'map.state.notice'));
  L.push(legendItem(SW.box(C.amberWin), 'sim.flex.window_legend'));
  return L;
}
function renderLegend() {
  if (S.mode === 'flex') {
    $$('#flexCharts [data-legend]').forEach(lg => {
      lg.innerHTML = flexLegendItems(lg.dataset.legend).join('');
      translate(lg);
    });
    return;
  }
  const cfg = E.nodi[S.node].configurazioni[S.cfg];
  const L = [];
  L.push(legendItem(SW.line(C.gray), 'sim.eff.series.import', null, 'sim.eff.before'));
  if (S.cfg !== 'stato_attuale') L.push(legendItem(SW.line(C.deep), 'sim.eff.series.import', null, 'sim.eff.after'));
  if (cfg.fv_kw) L.push(legendItem(SW.box('rgba(16,160,96,.16)', C.green), 'sim.eff.series.pv'));
  if (cfg.carica_kw) {
    L.push(legendItem(SW.box(C.navy), 'sim.eff.series.charge'));
    L.push(legendItem(SW.box(C.green), 'sim.eff.series.discharge'));
    L.push(legendItem(SW.line('#5A6B7C'), 'sim.eff.series.soc'));
  }
  if (cfg.soglia_picco_kw) L.push(legendItem(SW.line(C.red, '6 4'), 'sim.eff.series.peak_threshold'));
  const lg = $('#legend'); lg.innerHTML = L.join(''); translate(lg);
}

/* ---------- KPI ---------- */
function kpiItem(labelKey, val, unitKey, extra = '', wide) {
  return `<div class="kpi__item${wide ? ' is-wide' : ''}"><div class="kpi__label">${i18nSpan(labelKey)}</div><div class="kpi__val">${val}${unitKey ? `<small>${esc(t(unitKey))}</small>` : ''}</div>${extra}</div>`;
}
function renderKPI() {
  const p = $('#kpiPanel');
  if (S.mode === 'flex') renderFlexKPI(p); else renderEffKPI(p);
}
function renderFlexKPI(p) {
  const i = clamp(Math.floor(S.idx), 0, 287), n = S.node;
  let energy = null, ratio = null;
  if (n === 'MI') {
    const { ev } = phaseAt(i);
    energy = 0;
    if (ev && i >= ev.s) for (let k = ev.s; k <= Math.min(i, ev.f - 1); k++) energy += F.MI.flessibilita_kw[k] * 0.25;
    ratio = F.MI.rapporto_consegna[i];
  }
  const tol = DATA.meta.tolleranza_consegna_illustrativa;
  const chip = ratio == null ? '' : `<span class="chip ${ratio >= tol ? 'chip--ok' : 'chip--ko'}">${esc(t(ratio >= tol ? 'sim.flex.within_tolerance' : 'sim.flex.below_tolerance'))}</span>`;
  const it = (F[n].carico_it_kw || E.nodi[n].carico_it_kw)[i];
  const price = (F[n].prezzo_eur_mwh || E.nodi[n].prezzo_eur_mwh)[i];
  p.innerHTML = `<div class="kpi__body">
    <h3 style="margin-bottom:12px">${i18nSpan('map.nodes.' + n)}</h3>
    <div class="kpi__list">
      ${kpiItem('sim.flex.kpi.energy_modulated', n === 'MI' ? fmt(energy, 1) : '—', n === 'MI' ? 'units.kwh' : '')}
      ${kpiItem('sim.flex.kpi.delivery_ratio', ratio == null ? '—' : pct(ratio, 1), '', chip)}
      ${kpiItem('sim.flex.kpi.pue', fmt(F[n].pue[i], 2), '')}
      ${kpiItem('sim.flex.kpi.carbon', fmt(F.intensita_carbonica_g_kwh[i]), 'units.g_kwh')}
      ${kpiItem('sim.flex.kpi.it_load', fmt(it, 1), 'units.kw')}
      ${kpiItem('sim.flex.kpi.price', fmt(price, 1), 'units.eur_mwh')}
    </div>
    <p class="note kpi__foot">${esc(t('sim.flex.tolerance_note', { pct:fmt(tol * 100) }))}</p></div>`;
  translate(p);
}

const EFF_ROWS = [
  ['import','energia_prelevata_kwh','units.kwh',0,-1],
  ['export','energia_immessa_kwh','units.kwh',0,0],
  ['pv_prod','produzione_fv_kwh','units.kwh',0,1],
  ['self_consumption','autoconsumo','%',1,1,'sim.eff.tooltip.self_consumption',true],
  ['self_sufficiency','autosufficienza','%',1,1,'sim.eff.tooltip.self_sufficiency',true],
  ['peak','picco_prelievo_kw','units.kw',1,-1],
  ['pue','pue_medio','',3,0,'sim.eff.tooltip.pue'],
  ['co2','co2_kg','units.kg',0,-1],
  ['cue','cue_kgco2_kwh_it','units.kg_kwh',3,-1,'sim.eff.tooltip.cue'],
  ['cost','costo_energia_eur','units.eur',0,-1]
];
function dayEnergy(arr, d) { let s = 0; for (let k = d * 96; k < d * 96 + 96; k++) s += arr[k] * 0.25; return s; }
function kpiFor(node, cfgKey, day) {
  const nd = E.nodi[node], k = nd.configurazioni[cfgKey].kpi;
  if (day < 3) return k[day];
  const load = [0,1,2].map(d => dayEnergy(nd.carico_totale_kw, d));
  const itE = [0,1,2].map(d => dayEnergy(nd.carico_it_kw, d));
  const sum = f => k.reduce((a, x) => a + (x[f] || 0), 0);
  const pv = sum('produzione_fv_kwh');
  return {
    energia_prelevata_kwh:sum('energia_prelevata_kwh'), energia_immessa_kwh:sum('energia_immessa_kwh'), produzione_fv_kwh:pv,
    autoconsumo: pv > 0 ? k.reduce((a, x) => a + (x.autoconsumo || 0) * x.produzione_fv_kwh, 0) / pv : null,
    autosufficienza: k.reduce((a, x, d) => a + x.autosufficienza * load[d], 0) / load.reduce((a, b) => a + b, 0),
    picco_prelievo_kw: Math.max(...k.map(x => x.picco_prelievo_kw)),
    pue_medio: k.reduce((a, x, d) => a + x.pue_medio * itE[d], 0) / itE.reduce((a, b) => a + b, 0),
    co2_kg: sum('co2_kg'), cue_kgco2_kwh_it: sum('co2_kg') / itE.reduce((a, b) => a + b, 0), costo_energia_eur: sum('costo_energia_eur')
  };
}
function renderEffKPI(p) {
  const before = kpiFor(S.node, 'stato_attuale', 3), after = kpiFor(S.node, S.cfg, 3);
  const same = S.cfg === 'stato_attuale';
  const cell = (v, unit, d) => (v == null ? '—' : unit === '%' ? pct(v, d) : fmt(v, d));
  const rows = EFF_ROWS.map(([key, f, unit, d, dir, tip, pair]) => {
    const b = before[f], a = after[f];
    let delta = '—', cls = 'd-neu';
    if (!same && a != null && b != null) {
      const diff = unit === '%' ? a - b : (b ? (a - b) / b : null);
      if (diff != null && Math.abs(diff) > 1e-9) {
        delta = pct(diff, 1, { signDisplay:'exceptZero' });
        cls = dir === 0 ? 'd-neu' : (diff * dir > 0 ? 'd-good' : 'd-bad');
      } else if (diff != null) delta = pct(0, 0);
    }
    const info = tip ? `<button type="button" class="info" data-tip="${tip}" data-i18n-attr="aria-label:${tip}"></button>` : '';
    const u = unit && unit !== '%' ? ` <span class="u">${esc(t(unit))}</span>` : '';
    return `<tr${pair ? ' class="pair"' : ''}><td>${i18nSpan('sim.eff.kpi.' + key)}${info}</td><td>${cell(b, unit, d)}${u}</td><td>${same ? '—' : cell(a, unit, d) + u}</td><td class="${cls}">${delta}</td></tr>`;
  }).join('');
  p.innerHTML = `<div class="kpi__body">
    <h3 style="margin-bottom:10px">${i18nSpan('map.nodes.' + S.node)}</h3>
    <p class="note" style="margin:0 0 12px">${i18nSpan('sim.eff.configs.' + S.cfg)} · ${i18nSpan('sim.eff.kpi_total')}</p>
    <table class="ktable"><thead><tr><th scope="col"></th><th scope="col">${i18nSpan('sim.eff.before')}</th><th scope="col">${i18nSpan('sim.eff.after')}</th><th scope="col" data-i18n-attr="title:sim.eff.kpi.delta;aria-label:sim.eff.kpi.delta">${i18nSpan('sim.eff.kpi.delta_short')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  translate(p);
  renderEcon();
}

function renderBridge() {
  const kwh = E.nodi[S.node].taglia.accumulo_kwh, r = S.reserve / 100;
  $('#socSelf').style.width = (100 - S.reserve) + '%';
  $('#socRes').style.width = S.reserve + '%';
  $('#socSelfVal').textContent = `${pct(1 - r)} · ${fmt(kwh * (1 - r))} ${t('units.kwh')}`;
  $('#socResVal').textContent = `${pct(r)} · ${fmt(kwh * r)} ${t('units.kwh')}`;
}
function renderEcon() {
  const nd = E.nodi[S.node];
  const hasPv = S.cfg !== 'stato_attuale', hasBess = S.cfg.includes('accumulo');
  const capex = (hasPv ? nd.taglia.fv_kwp * S.capexPv : 0) + (hasBess ? nd.taglia.accumulo_kwh * S.capexBess : 0);
  const saving = (kpiFor(S.node, 'stato_attuale', 3).costo_energia_eur - kpiFor(S.node, S.cfg, 3).costo_energia_eur) * 365 / 3;
  $('#econCapex').textContent = `${fmt(capex)} ${t('units.eur')}`;
  $('#econSaving').textContent = `${fmt(saving)} ${t('units.eur_year')}`;
  $('#econPayback').textContent = capex > 0 && saving > 0 ? `${fmt(capex / saving, 1)} ${t('units.years')}` : t('sim.eff.econ_na');
}

/* ---------- tooltips ---------- */
function initTips() {
  const tip = el('div', { class:'tip', role:'tooltip', hidden:'' }); document.body.appendChild(tip);
  const show = e => {
    const b = e.target.closest('[data-tip]'); if (!b) return;
    tip.textContent = t(b.dataset.tip); tip.hidden = false;
    const r = b.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let x = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8), y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  const hide = e => { if (e.target.closest && e.target.closest('[data-tip]')) tip.hidden = true; };
  document.addEventListener('mouseover', show); document.addEventListener('focusin', show);
  document.addEventListener('mouseout', hide); document.addEventListener('focusout', hide);
  addEventListener('scroll', () => { tip.hidden = true; }, { passive:true });
}

/* ---------- interval tick ---------- */
function onInterval() {
  const i = clamp(Math.floor(S.idx), 0, 287);
  if (S.mode === 'flex') {
    $('#clock').textContent = `${t('sim.time')} ${time(F.timestamp[i])}`;
    renderFlexKPI($('#kpiPanel'));
    const { ev, phase } = phaseAt(i);
    const flag = $('#chartFlag');
    if (phase === 'notice') {
      flag.hidden = false; flag.classList.remove('is-window');
      flag.textContent = t('sim.flex.notice', { min:fmt(Math.max(0, Math.ceil((ev.s - S.idx) * 15))) });
    } else if (phase === 'window') {
      flag.hidden = false; flag.classList.add('is-window'); flag.textContent = t('sim.flex.window_active');
    } else flag.hidden = true;
    const card = $('#eventCard');
    if (phase === 'after' && i < ev.f + 24 && S.dismissed !== ev.id) {
      if (card.dataset.ev !== ev.id || card.hidden) {
        card.dataset.ev = ev.id;
        card.innerHTML = `<button type="button" class="x" data-i18n-attr="aria-label:arch.close">×</button>
          <h4>${i18nSpan('sim.flex.event.title', { id:ev.id })}</h4><p>${i18nSpan(ev.nota_key)}</p>
          <div class="row"><span>${i18nSpan('sim.flex.event.delivery_avg')}</span><b class="${ev.consegna_media >= DATA.meta.tolleranza_consegna_illustrativa ? 'd-good' : 'd-bad'}">${pct(ev.consegna_media, 1)}</b></div>
          <div class="row">${i18nSpan('sim.flex.event.intervals_ok', { n:ev.intervalli_entro_tolleranza, tot:ev.intervalli })}</div>`;
        card.querySelector('.x').addEventListener('click', () => { S.dismissed = ev.id; card.hidden = true; });
        translate(card); card.hidden = false;
      }
    } else card.hidden = true;
  } else { $('#chartFlag').hidden = true; $('#eventCard').hidden = true; }
  updateMapState(i);
}

/* ---------- chart ---------- */
let ctx, CW = 0, CH = 0;
function fitCanvas(c) {
  const r = c.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = r.width, h = r.height, bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  const g = c.getContext('2d');
  if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}
function sizeCanvas() {
  const list = S.mode === 'flex' ? $$('#flexCharts canvas') : [$('#chart')];
  list.forEach(c => { c._view = fitCanvas(c); });
}
function niceTicks(lo, hi, n = 4) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
function path(pts, color, w, dash) {
  if (!pts.length) return;
  ctx.beginPath(); pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
}
function yAxis(x0, x1, y, ticks, digits = 0, right) {
  ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillStyle = C.text; ctx.textBaseline = 'middle';
  ticks.forEach(v => {
    const yy = y(v);
    if (!right) { ctx.strokeStyle = v === 0 ? '#9AA8B5' : C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); }
    ctx.textAlign = right ? 'left' : 'right'; ctx.fillText(fmt(v, digits), right ? x1 + 6 : x0 - 6, yy);
  });
}
function drawChart() {
  if (!DATA) return;
  const list = S.mode === 'flex' ? $$('#flexCharts canvas') : [$('#chart')];
  list.forEach(c => {
    if (!c._view) c._view = fitCanvas(c);
    const v = c._view;
    if (!v) return;
    ctx = v.g; CW = v.w; CH = v.h;
    ctx.clearRect(0, 0, CW, CH);
    if (S.mode === 'flex') drawFlex(c.dataset.node); else drawEff();
  });
}
function drawFlex(n) {
  const cur = clamp(S.idx, 0, 288);
  const padL = 46, padR = 8, padT = 26, padB = 20, gap = 10;
  const low = n === 'MI' || n === 'RM', plotH = CH - padT - padB, topH = low ? plotH * 0.58 : plotH;
  const lowTop = padT + topH + gap, lowH = plotH - topH - gap;
  const x = k => padL + (k / 288) * (CW - padL - padR);
  const [lo, hi] = S.range[n];
  const span = (hi - lo) || 1;
  const yT = v => padT + topH - ((v - lo) / span) * topH;
  const plotBottom = low ? lowTop + lowH : padT + topH;
  for (let k = 0; k < 288; k++) {
    if (F.preavviso_attivo[k] || F.finestra_attiva[k]) {
      ctx.fillStyle = F.finestra_attiva[k] ? C.amberWin : C.amberSoft;
      ctx.fillRect(x(k), padT - 4, Math.max(0.4, x(k + 1) - x(k)), plotBottom - padT + 4);
    }
  }
  yAxis(padL, CW - padR, yT, niceTicks(lo, hi, 3));
  ctx.font = '600 10px "IBM Plex Mono", monospace';
  for (let d = 0; d < 3; d++) {
    const xd = x(d * 96);
    if (d) { ctx.strokeStyle = '#B9C6D1'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xd, padT - 14); ctx.lineTo(xd, CH - padB); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = C.navy; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(t('sim.day', { n:d + 1 }), xd + 4, padT - 6);
  }
  ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let k = 0; k < 288; k += 24) if (k % 96) ctx.fillText(time(F.timestamp[k]), x(k), CH - padB + 4);
  const partial = arr => {
    const pts = [];
    for (let k = 0; k < 288; k++) {
      const c = k + 0.5;
      if (c > cur) {
        if (k > 0) { const a = arr[k - 1], b = arr[k], f = cur - (k - 0.5); pts.push([x(cur), yT(a + (b - a) * f)]); }
        break;
      }
      pts.push([x(c), yT(arr[k])]);
    }
    return pts;
  };
  if (F[n].baseline_kw) path(F[n].baseline_kw.map((v, k) => [x(k + 0.5), yT(v)]), C.navy, 1.4, [5, 4]);
  path(partial(F[n].misurato_pod_kw), C.green, 2);
  if (n === 'MI') {
    const [a, b] = S.leverRange, yL = v => lowTop + lowH - ((v - a) / ((b - a) || 1)) * lowH;
    yAxis(padL, CW - padR, yL, niceTicks(a, b, 3));
    for (let k = 0; k < 288 && k < cur; k++) {
      let pos = 0, neg = 0; const x0 = x(k), w = Math.max(0.4, x(k + 1) - x(k) - 0.3);
      LEVERS.forEach(([key, f, , col]) => {
        if (!S.levers[key]) return; const v = F.MI[f][k]; if (!v) return;
        ctx.fillStyle = col;
        if (v > 0) { ctx.fillRect(x0, yL(pos + v), w, yL(pos) - yL(pos + v)); pos += v; }
        else { ctx.fillRect(x0, yL(neg), w, yL(neg + v) - yL(neg)); neg += v; }
      });
    }
    ctx.beginPath(); let on = false;
    for (let k = 0; k < 288; k++) {
      const r = F.richiesta_kw[k];
      const ev = EVENTS.find(e => k >= e.s && k < e.f);
      if (r > 0 && ev && ev.n <= S.idx) {
        if (!on) { ctx.moveTo(x(k), yL(0)); on = true; }
        ctx.lineTo(x(k), yL(r)); ctx.lineTo(x(k + 1), yL(r));
      } else if (on) { ctx.lineTo(x(k), yL(0)); on = false; }
    }
    if (on) ctx.lineTo(x(288), yL(0));
    ctx.strokeStyle = C.req; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
  } else if (n === 'RM') {
    const yL = v => lowTop + lowH - (v / (S.recvMax || 1)) * lowH;
    yAxis(padL, CW - padR, yL, niceTicks(0, S.recvMax, 2));
    const arr = F.RM.carico_ricevuto_kw;
    ctx.beginPath(); ctx.moveTo(x(0.5), yL(0));
    let lastX = x(0.5);
    for (let k = 0; k < 288 && k + 0.5 <= cur; k++) { lastX = x(k + 0.5); ctx.lineTo(lastX, yL(arr[k])); }
    ctx.lineTo(lastX, yL(0)); ctx.closePath();
    ctx.fillStyle = 'rgba(136,173,167,.45)'; ctx.fill(); ctx.strokeStyle = C.deep; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.text; ctx.font = '600 10px "IBM Plex Mono", monospace';
  ctx.fillText(t('units.kw'), 4, 12);
  if (!(reduced && !S.playing) || cur < 287.9) {
    const px = x(cur);
    ctx.strokeStyle = C.navy; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, padT - 4); ctx.lineTo(px, plotBottom); ctx.stroke();
    const g = clamp(Math.floor(S.idx), 0, 287);
    ctx.fillStyle = C.green; ctx.beginPath(); ctx.arc(px, yT(F[n].misurato_pod_kw[g]), 3.5, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  }
}
function drawEff() {
  const nd = E.nodi[S.node], cfg = nd.configurazioni[S.cfg], base = nd.configurazioni.stato_attuale;
  const bess = !!cfg.carica_kw;
  const padL = 50, padR = bess ? 44 : 14, padT = 34, padB = 24, gap = 16;
  const plotH = CH - padT - padB, topH = bess ? plotH * 0.64 : plotH, lowTop = padT + topH + gap, lowH = plotH - topH - gap;
  const x = k => padL + (k / 288) * (CW - padL - padR);
  let hi = 0; for (let k = 0; k < 288; k++) hi = Math.max(hi, base.prelievo_kw[k], cfg.prelievo_kw[k], cfg.fv_kw ? cfg.fv_kw[k] : 0);
  hi *= 1.08;
  const yT = v => padT + topH - (v / hi) * topH;
  yAxis(padL, CW - padR, yT, niceTicks(0, hi, 4));
  // day separators + labels
  ctx.font = '600 11px "IBM Plex Mono", monospace';
  for (let d = 0; d < 3; d++) {
    const xd = x(d * 96);
    if (d) { ctx.strokeStyle = '#B9C6D1'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xd, padT - 22); ctx.lineTo(xd, CH - padB); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = C.navy; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${t('sim.day', { n:d + 1 })} · ${t(E.meteo_giorno_key[d])}`, xd + 6, padT - 12);
  }
  ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let k = 0; k < 288; k += 24) if (k % 96) ctx.fillText(time(E.timestamp[k]), x(k), CH - padB + 8);
  // FV area
  if (cfg.fv_kw) {
    ctx.beginPath(); ctx.moveTo(x(0.5), yT(0));
    cfg.fv_kw.forEach((v, k) => ctx.lineTo(x(k + 0.5), yT(v)));
    ctx.lineTo(x(287.5), yT(0)); ctx.closePath();
    ctx.fillStyle = 'rgba(16,160,96,.14)'; ctx.fill(); ctx.strokeStyle = 'rgba(16,160,96,.7)'; ctx.lineWidth = 1; ctx.stroke();
  }
  const pts = (arr, yf) => arr.map((v, k) => [x(k + 0.5), yf(v)]);
  path(pts(base.prelievo_kw, yT), C.gray, 1.6);
  if (S.cfg !== 'stato_attuale') path(pts(cfg.prelievo_kw, yT), C.deep, 2.2);
  if (cfg.soglia_picco_kw) {
    path([[padL, yT(cfg.soglia_picco_kw)], [CW - padR, yT(cfg.soglia_picco_kw)]], C.red, 1.4, [6, 4]);
  }
  if (bess) {
    const m = Math.max(nd.taglia.accumulo_kw, ...cfg.carica_kw, ...cfg.scarica_kw) * 1.1;
    const yL = v => lowTop + lowH / 2 - (v / m) * (lowH / 2);
    const yS = v => lowTop + lowH - (v / 100) * lowH;
    yAxis(padL, CW - padR, yL, niceTicks(-m, m, 2));
    yAxis(padL, CW - padR, yS, [0, 50, 100], 0, true);
    for (let k = 0; k < 288; k++) {
      const x0 = x(k), w = Math.max(0.8, x(k + 1) - x(k) - 0.3);
      if (cfg.carica_kw[k] > 0) { ctx.fillStyle = C.navy; ctx.fillRect(x0, yL(cfg.carica_kw[k]), w, yL(0) - yL(cfg.carica_kw[k])); }
      if (cfg.scarica_kw[k] > 0) { ctx.fillStyle = C.green; ctx.fillRect(x0, yL(0), w, yL(-cfg.scarica_kw[k]) - yL(0)); }
    }
    path(pts(cfg.soc_pct, yS), '#5A6B7C', 1.3);
    ctx.fillStyle = C.text; ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('%', CW - 4, lowTop - 4);
  }
  ctx.fillStyle = C.text; ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(t('units.kw'), 6, padT - 12);
}

/* ---------- geography ---------- */
const BB = { lon0:6.4, lon1:18.8, lat0:36.4, lat1:47.2 }, VW = 400, VH = 460, PAD = 14;
const mx = lon => lon * Math.PI / 180, my = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const PX0 = mx(BB.lon0), PX1 = mx(BB.lon1), PY0 = my(BB.lat0), PY1 = my(BB.lat1);
const PS = Math.min((VW - 2 * PAD) / (PX1 - PX0), (VH - 2 * PAD) / (PY1 - PY0));
const POX = (VW - (PX1 - PX0) * PS) / 2, POY = (VH - (PY1 - PY0) * PS) / 2;
const proj = ([lon, lat]) => [POX + (mx(lon) - PX0) * PS, POY + (PY1 - my(lat)) * PS];
function trace(pts) {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, adx = Math.abs(dx), ady = Math.abs(dy);
    const m = ady > adx ? [ax, ay + Math.sign(dy) * (ady - adx)] : [ax + Math.sign(dx) * (adx - ady), ay];
    d += ` L${m[0].toFixed(1)} ${m[1].toFixed(1)} L${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  return d;
}
async function loadItaly() {
  try {
    if (!window.d3 || !window.topojson) throw new Error('d3 unavailable');
    const topo = await (await fetch(CONFIG.atlas)).json();
    const feats = topojson.feature(topo, topo.objects.countries).features;
    const it = feats.find(f => f.id === '380');
    const gp = d3.geoPath(d3.geoTransform({ point(lon, lat) { const [x, y] = proj([lon, lat]); this.stream.point(x, y); } }));
    return gp(it);
  } catch (e) { console.warn('[map] outline not loaded:', e.message); return null; }
}

/* ---------- hero ---------- */
let heroPulse, heroRings = [], heroLen = 0;
function buildHero(outline) {
  const s = $('#heroMap'); s.innerHTML = '';
  const defs = sv('defs');
  defs.innerHTML = `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  s.appendChild(defs);
  if (outline) s.appendChild(sv('path', { d:outline, fill:'rgba(18,42,72,.9)', stroke:'rgba(52,217,142,.55)', 'stroke-width':1.3 }));
  const P = { N:proj([8.6, 46.6]), MI:proj([9.19, 45.46]), RM:proj([12.5, 41.9]), NA:proj([14.27, 40.85]), C:proj([16.3, 39.0]), SI:proj([14.6, 37.5]) };
  const d = trace([P.N, P.MI, P.RM, P.NA, P.C, P.SI]);
  const g = sv('g', { fill:'none', 'stroke-linecap':'round', 'stroke-linejoin':'round' });
  [[P.MI, [P.MI[0] - 40, P.MI[1] + 24]], [P.RM, [P.RM[0] - 34, P.RM[1] + 30]], [P.NA, [P.NA[0] + 36, P.NA[1] - 20]], [P.MI, [P.MI[0] + 52, P.MI[1] - 14]]].forEach(([a, b]) => {
    g.appendChild(sv('path', { d:trace([a, b]), stroke:'rgba(136,173,167,.55)', 'stroke-width':1.4 }));
    g.appendChild(sv('circle', { cx:b[0], cy:b[1], r:2.6, fill:'#0A1C32', stroke:'rgba(136,173,167,.8)', 'stroke-width':1.2 }));
  });
  g.appendChild(sv('path', { d, stroke:'rgba(52,217,142,.35)', 'stroke-width':3 }));
  heroPulse = sv('path', { d, stroke:C.neon, 'stroke-width':3.2, filter:'url(#glow)' });
  g.appendChild(heroPulse); s.appendChild(g);
  heroLen = heroPulse.getTotalLength();
  if (reduced) heroPulse.setAttribute('stroke-dasharray', 'none');
  else heroPulse.setAttribute('stroke-dasharray', `90 ${heroLen}`);
  heroRings = [];
  ['MI','RM','NA'].forEach((k, i) => {
    const [x, y] = P[k];
    const ring = sv('circle', { cx:x, cy:y, r:10, fill:'none', stroke:C.neon, 'stroke-width':1.5, opacity:.6 });
    s.appendChild(ring); heroRings.push([ring, i]);
    s.appendChild(sv('circle', { cx:x, cy:y, r:5.5, fill:C.neon, filter:'url(#glow)' }));
    s.appendChild(sv('circle', { cx:x, cy:y, r:2.5, fill:'#fff' }));
  });
  const leafG = sv('g', { opacity:.9 });
  [[P.SI[0] + 4, P.SI[1] - 5, 0], [P.N[0] - 4, P.N[1] - 16, -120]].forEach(([x, y, r]) => {
    const u = sv('use', { href:'#leaf', x:0, y:0, width:26, height:15, transform:`translate(${x} ${y}) rotate(${r})` }); leafG.appendChild(u);
  });
  s.appendChild(leafG);
}
function heroFrame(ts) {
  if (!heroPulse) return;
  const p = (ts / 4200) % 1;
  heroPulse.setAttribute('stroke-dashoffset', String(-p * (heroLen + 90) + 90));
  heroRings.forEach(([r, i]) => { const q = ((ts / 1800) + i * 0.33) % 1; r.setAttribute('r', 6 + q * 16); r.setAttribute('opacity', (1 - q) * 0.7); });
}

/* ---------- network map ---------- */
const M = {};
function buildMap(outline) {
  const s = $('#netMap'); s.innerHTML = '';
  const defs = sv('defs');
  defs.innerHTML = `<pattern id="mgrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(136,173,167,.18)" stroke-width="1"/></pattern>
    <marker id="mArr" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${C.deep}"/></marker>`;
  s.appendChild(defs);
  s.appendChild(sv('rect', { x:0, y:0, width:VW, height:VH, fill:'url(#mgrid)' }));
  if (outline) s.appendChild(sv('path', { d:outline, fill:'#fff', stroke:C.navy, 'stroke-width':1.6, 'stroke-linejoin':'round' }));
  M.pos = { MI:proj([DATA.nodi.MI.lon, DATA.nodi.MI.lat]), RM:proj([DATA.nodi.RM.lon, DATA.nodi.RM.lat]), NA:proj([DATA.nodi.NA.lon, DATA.nodi.NA.lat]) };
  const links = sv('g', { class:'links', fill:'none', 'stroke-linecap':'round', 'stroke-linejoin':'round' });
  const dMR = trace([M.pos.MI, M.pos.RM]), dRN = trace([M.pos.RM, M.pos.NA]);
  [dMR, dRN].forEach(d => {
    links.appendChild(sv('path', { d, stroke:C.navy, 'stroke-width':4 }));
    links.appendChild(sv('path', { d, stroke:'#fff', 'stroke-width':1.4, 'stroke-dasharray':'1 7' }));
  });
  s.appendChild(links); M.links = links;
  M.pathMR = sv('path', { d:dMR, fill:'none', stroke:'none' }); s.appendChild(M.pathMR);
  M.lenMR = M.pathMR.getTotalLength();
  M.flow = sv('path', { d:dMR, fill:'none', stroke:C.green, 'stroke-width':3, opacity:0, 'marker-end':'url(#mArr)' });
  s.appendChild(M.flow);
  M.particles = sv('g'); s.appendChild(M.particles);
  M.pool = Array.from({ length:12 }, () => { const c = sv('circle', { r:3.6, fill:C.neon, stroke:C.deep, 'stroke-width':1, opacity:0 }); M.particles.appendChild(c); return c; });
  // rejected overlay
  const mid = M.pathMR.getPointAtLength(M.lenMR / 2);
  M.reject = sv('g', { opacity:0 });
  M.reject.appendChild(sv('path', { d:dMR, fill:'none', stroke:C.red, 'stroke-width':3, 'stroke-dasharray':'7 6' }));
  M.reject.appendChild(sv('path', { d:`M${mid.x - 9} ${mid.y - 9}L${mid.x + 9} ${mid.y + 9}M${mid.x + 9} ${mid.y - 9}L${mid.x - 9} ${mid.y + 9}`, stroke:C.red, 'stroke-width':4, 'stroke-linecap':'round' }));
  const rl = sv('text', { x:mid.x + 14, y:mid.y + 4, class:'node__label', fill:C.red, style:`fill:${C.red}`, 'data-i18n':'map.tooltip.rejected' });
  M.reject.appendChild(rl); s.appendChild(M.reject);
  // hit area for tooltip
  M.hit = sv('path', { d:dMR, fill:'none', stroke:'transparent', 'stroke-width':22, class:'transfer-hit', tabindex:0, role:'button', 'data-i18n-attr':'aria-label:map.tooltip.title' });
  M.hit.addEventListener('mouseenter', () => showMapTip(true)); M.hit.addEventListener('mouseleave', () => showMapTip(false));
  M.hit.addEventListener('focus', () => showMapTip(true)); M.hit.addEventListener('blur', () => showMapTip(false));
  s.appendChild(M.hit);
  // nodes
  M.nodes = {};
  ['MI','RM','NA'].forEach(k => {
    const [x, y] = M.pos[k];
    const g = sv('g', { class:'node', tabindex:0, role:'button', 'data-node':k, 'data-i18n-attr':`aria-label:map.nodes.${k}` });
    const halo = sv('circle', { cx:x, cy:y, r:14, fill:'none', stroke:C.green, 'stroke-width':2, opacity:0 });
    const ring = sv('circle', { cx:x, cy:y, r:12, fill:'#fff', stroke:C.navy, 'stroke-width':2.5, class:'node__ring' });
    const core = sv('circle', { cx:x, cy:y, r:6.5, fill:C.green });
    const lblX = x + 18;
    const bg = sv('rect', { x:lblX - 4, y:y - 15, width:10, height:34, rx:5, fill:'rgba(241,245,248,.85)' });
    const name = sv('text', { x:lblX, y:y - 1, class:'node__label', 'data-i18n':`map.nodes.${k}` });
    const st = sv('text', { x:lblX, y:y + 13, class:'node__state flex-l' });
    const eff = sv('g', { class:'eff-l', transform:`translate(${lblX} ${y + 10})` });
    g.append(halo, bg, ring, core, name, st, eff);
    g.addEventListener('click', () => { setNode(k); });
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setNode(k); } });
    s.appendChild(g);
    M.nodes[k] = { g, halo, ring, core, st, eff, bg, name, ax:lblX, ay:y + 10 };
  });
  $('#n4Box').addEventListener('click', () => setNode('N4'));
  const yields = NODES.map(n => E.nodi[n].configurazioni.fv.kpi.reduce((a, x) => a + x.produzione_fv_kwh, 0) / E.nodi[n].taglia.fv_kwp);
  const yMin = Math.min(...yields), yMax = Math.max(...yields);
  M.solar = {}; NODES.forEach((n, i) => { M.solar[n] = 1 + Math.round(2 * (yields[i] - yMin) / ((yMax - yMin) || 1)); });
  translate(s);
  renderEffIcons();
  renderMapMode(); renderMapSelection();
}
function cfgGlyph(c) {
  const pv = `<rect x="1" y="3" width="12" height="12" fill="rgba(16,160,96,.28)" stroke="currentColor" stroke-width="1.3"/><path d="M7 3v12M1 9h12" stroke="currentColor" stroke-width=".7"/>`;
  const batt = (idle, extra) => `<rect x="16.5" y="5" width="8" height="12" rx="1" fill="#fff" stroke="currentColor" stroke-width="1.3"${idle ? ' stroke-dasharray="2 1.4"' : ''}/><rect x="18.6" y="3.2" width="3.8" height="2" fill="currentColor"/>${extra}`;
  let body = '';
  if (c === 'stato_attuale') body = `<rect x="1" y="3" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.4"/>${batt(true, '')}`;
  else if (c === 'fv') body = pv;
  else if (c === 'fv_accumulo_autoconsumo') body = pv + batt(false, `<rect x="18" y="11" width="5" height="4.6" fill="${C.green}"/>`);
  else body = pv + batt(false, `<rect x="18" y="11" width="5" height="4.6" fill="${C.green}"/><path d="M17.2 9.2H23.8" stroke="${C.red}" stroke-width="1.2" stroke-dasharray="1.6 1"/>`);
  return `<svg class="cfg-card__ico" width="28" height="22" viewBox="0 0 26 20" aria-hidden="true">${body}</svg>`;
}
function renderEffIcons() {
  if (!M.nodes) return;
  NODES.forEach(n => {
    const svg = effIcons(n);
    if (n === 'N4') $('#n4Eff').innerHTML = svg ? `<svg width="88" height="28" viewBox="-1 -4 88 28" aria-hidden="true">${svg}</svg>` : '';
    else M.nodes[n].eff.innerHTML = svg;
  });
}
function effIcons(n) {
  const nd = E.nodi[n], tg = nd.taglia, cfg = nd.configurazioni[S.cfg];
  const hasPv = S.cfg !== 'stato_attuale', hasBess = S.cfg.includes('accumulo');
  const idle = !!(cfg && cfg.accumulo_inattivo), peak = S.cfg === 'fv_accumulo_riduzione_picchi';
  if (!hasPv && !hasBess) return '';
  const base = 22;
  let x = 0, s = '';
  if (hasPv) {
    const pv = 8 + 12 * Math.sqrt(tg.fv_kwp / 250);
    s += `<g transform="translate(${x} ${base - pv})"><rect width="${pv}" height="${pv}" fill="rgba(16,160,96,.18)" stroke="${C.deep}" stroke-width="1.4"/><path d="M${pv / 2} 0V${pv}M0 ${pv / 2}H${pv}" stroke="${C.deep}" stroke-width=".8"/></g>`;
    x += pv + 5;
    const bars = M.solar ? M.solar[n] : 0;
    for (let i = 0; i < 3; i++) s += `<rect x="${x + i * 5}" y="${base - 6 - i * 4}" width="3.5" height="${6 + i * 4}" fill="${i < bars ? C.amber : '#D3DDE5'}"/>`;
    x += 18;
  }
  if (hasBess) {
    const bh = 8 + 12 * Math.sqrt(tg.accumulo_kwh / 300), bw = Math.max(7, bh * 0.6);
    const stroke = idle ? C.gray : C.navy, dash = idle ? ' stroke-dasharray="2 1.5"' : '';
    const fill = idle ? '' : `<rect x="1.6" y="${bh * 0.42}" width="${bw - 3.2}" height="${Math.max(2, bh * 0.58 - 2)}" fill="${C.green}"/>`;
    const mark = peak ? `<path d="M1 ${bh * 0.36}H${bw - 1}" stroke="${C.red}" stroke-width="1.2" stroke-dasharray="2 1.4"/>` : '';
    s += `<g transform="translate(${x} ${base - bh})"><rect width="${bw}" height="${bh}" rx="1.5" fill="#fff" stroke="${stroke}" stroke-width="1.4"${dash}/><rect x="${bw * 0.28}" y="-2.4" width="${bw * 0.44}" height="2.4" fill="${stroke}"/>${fill}${mark}</g>`;
  }
  return s;
}
function fitLabels() {
  if (!M.nodes) return;
  const eff = S.mode === 'eff';
  Object.values(M.nodes).forEach(o => {
    try {
      const nameW = o.name.getComputedTextLength();
      let iconW = 0, iconH = 0;
      if (eff) {
        const bb = o.eff.getBBox();
        if (bb.width > 1) { iconW = bb.width; iconH = bb.height; }
      }
      const w = Math.max(nameW, iconW, 70) + 10;
      let x = o.ax;
      if (x - 4 + w > VW - 6) x -= (x - 4 + w) - (VW - 6);
      o.bg.setAttribute('x', x - 4);
      o.bg.setAttribute('width', w);
      o.name.setAttribute('x', x);
      o.st.setAttribute('x', x);
      o.eff.setAttribute('transform', `translate(${x} ${o.ay})`);
      o.bg.setAttribute('height', eff ? (iconH > 1 ? 28 + iconH : 24) : 34);
    } catch (e) { /* label metrics unavailable before layout */ }
  });
}
function renderMapMode() {
  const box = $('#mapBox'); if (!M.nodes) return;
  const eff = S.mode === 'eff';
  box.dataset.mode = S.mode;
  $$('.flex-l', $('#netMap')).forEach(n => n.style.display = eff ? 'none' : '');
  $$('.eff-l', $('#netMap')).forEach(n => n.style.display = eff ? '' : 'none');
  $('#n4Eff').hidden = !eff; $('#n4State').hidden = eff;
  M.links.style.opacity = eff ? 0.28 : 1;
  const leg = (svg, key) => `<span>${svg}${i18nSpan(key)}</span>`;
  const L = eff ? effLegend(leg) : [['normal', C.green, ''], ['notice', C.amberSoft, C.amber], ['request', C.amber, ''], ['receiving', C.green, C.neon]].map(([k, f, b]) =>
        `<span><i style="background:${f};${b ? `box-shadow:0 0 0 2px ${b}` : ''}"></i>${i18nSpan('map.state.' + k)}</span>`)
      .concat([`<span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4" fill="${C.neon}" stroke="${C.deep}"/></svg>${i18nSpan('map.tooltip.it_load')}</span>`]);
  const lg = $('#mapLegend'); lg.innerHTML = L.join(''); translate(lg);
  updateMapState(clamp(Math.floor(S.idx), 0, 287));
  fitLabels();
}
function effLegend(leg) {
  const hasPv = S.cfg !== 'stato_attuale', hasBess = S.cfg.includes('accumulo');
  const idle = hasBess && NODES.some(n => E.nodi[n].configurazioni[S.cfg].accumulo_inattivo);
  const L = [];
  if (!hasPv) L.push(leg(`<svg width="14" height="14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" fill="none" stroke="${C.gray}" stroke-width="1.4" stroke-dasharray="2 1.4"/></svg>`, 'map.eff_legend.absent'));
  if (hasPv) {
    L.push(leg(`<svg width="14" height="14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" fill="rgba(16,160,96,.18)" stroke="${C.deep}" stroke-width="1.4"/></svg>`, 'map.eff_legend.pv'));
    L.push(leg(`<svg width="14" height="14" aria-hidden="true"><rect x="1" y="9" width="3" height="4" fill="${C.amber}"/><rect x="5.5" y="6" width="3" height="7" fill="${C.amber}"/><rect x="10" y="3" width="3" height="10" fill="#D3DDE5"/></svg>`, 'map.eff_legend.solar'));
  }
  if (hasBess) L.push(leg(`<svg width="14" height="14" aria-hidden="true"><rect x="3" y="1" width="8" height="12" fill="#fff" stroke="${C.navy}" stroke-width="1.4"/><rect x="4.5" y="7" width="5" height="5" fill="${C.green}"/></svg>`, 'map.eff_legend.bess'));
  if (idle) L.push(leg(`<svg width="14" height="14" aria-hidden="true"><rect x="3" y="1" width="8" height="12" fill="#fff" stroke="${C.gray}" stroke-width="1.4" stroke-dasharray="2 1.4"/></svg>`, 'map.eff_legend.bess_idle'));
  if (S.cfg === 'fv_accumulo_riduzione_picchi') L.push(leg(`<svg width="14" height="14" aria-hidden="true"><path d="M1 7H13" stroke="${C.red}" stroke-width="1.4" stroke-dasharray="2 1.5"/></svg>`, 'sim.eff.series.peak_threshold'));
  return L;
}
function renderMapSelection() {
  if (!M.nodes) return;
  Object.entries(M.nodes).forEach(([k, o]) => {
    const sel = k === S.node;
    o.ring.setAttribute('stroke-width', sel ? 4.5 : 2.5);
    o.ring.setAttribute('r', sel ? 13 : 12);
    o.name.style.fontWeight = sel ? '800' : '600';
    o.g.setAttribute('aria-pressed', String(sel));
  });
  $('#n4Box').classList.toggle('is-sel', S.node === 'N4');
  $('#n4Box').setAttribute('aria-pressed', String(S.node === 'N4'));
}
function nodeState(n, i) {
  if (S.mode !== 'flex') return 'normal';
  const { ev, phase } = phaseAt(i);
  if (!ev) return 'normal';
  if (n === ev.nodo_sorgente) return phase === 'notice' ? 'notice' : phase === 'window' ? 'request' : 'normal';
  if (n === ev.nodo_destinazione && phase === 'window' && ev.spostamento_spaziale_accettato) return 'receiving';
  return 'normal';
}
const STATE_FILL = { normal:C.green, notice:'#F6D9A8', request:C.amber, receiving:C.green };
function updateMapState(i) {
  if (!M.nodes) return;
  M.state = {};
  NODES.forEach(n => {
    const st = nodeState(n, i); M.state[n] = st;
    if (n === 'N4') { $('#n4Dot').style.background = STATE_FILL[st]; $('#n4State').textContent = t('map.state.' + st); return; }
    const o = M.nodes[n];
    o.core.setAttribute('fill', STATE_FILL[st]);
    o.ring.setAttribute('stroke', st === 'notice' || st === 'request' ? C.amber : C.navy);
    o.st.textContent = t('map.state.' + st);
    o.st.style.fill = st === 'normal' ? C.text : st === 'receiving' ? C.deep : C.req;
  });
  const { ev, phase } = phaseAt(i);
  M.kw = S.mode === 'flex' ? TRANSFER[i] : 0;
  M.rejected = S.mode === 'flex' && phase === 'window' && ev && !ev.spostamento_spaziale_accettato;
  M.reject.setAttribute('opacity', M.rejected ? 1 : 0);
  M.flow.setAttribute('opacity', M.kw > 0 ? 0.9 : 0);
  if (!$('#mapTip').hidden) showMapTip(true);
}
function mapFrame(ts, dt) {
  if (!M.pool) return;
  const kw = M.kw || 0, N = kw > 0 ? clamp(Math.round(kw / 2.2), 3, 12) : 0;
  const speed = reduced ? 0 : 0.18 * (1 + Math.log2(S.speed) * 0.25) * (S.playing ? 1 : 0.35);
  M.phase = ((M.phase || 0) + dt * speed) % 1;
  M.pool.forEach((c, j) => {
    if (j >= N) { c.setAttribute('opacity', 0); return; }
    const f = (M.phase + j / N) % 1, p = M.pathMR.getPointAtLength(f * M.lenMR);
    c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
    c.setAttribute('opacity', (0.45 + 0.55 * clamp(kw / 23, 0, 1)) * Math.sin(Math.PI * f) ** 0.4);
  });
  const rc = M.nodes.RM.halo;
  if (M.state && M.state.RM === 'receiving' && !reduced) { const q = (ts / 1400) % 1; rc.setAttribute('r', 13 + q * 14); rc.setAttribute('opacity', 1 - q); }
  else rc.setAttribute('opacity', M.state && M.state.RM === 'receiving' ? 0.8 : 0);
}
function relevantEvent(i) {
  const { ev, phase } = phaseAt(i);
  if (ev && (phase === 'notice' || phase === 'window' || phase === 'after')) return ev;
  return EVENTS[0];
}
function showMapTip(on) {
  const tip = $('#mapTip');
  if (!on || S.mode !== 'flex') { tip.hidden = true; return; }
  const i = clamp(Math.floor(S.idx), 0, 287), ev = relevantEvent(i), ts = ev.test_spostamento;
  const ok = ts.esito === 'accettato';
  const row = (k, v) => `<tr><td>${esc(t(k))}</td><td>${v}</td></tr>`;
  tip.innerHTML = `<h4>${esc(t('map.tooltip.title'))} · ${esc(ev.id)}</h4><table>
    ${row('map.tooltip.src_energy', `${fmt(ts.energia_evitata_sorgente_mwh, 4)} ${esc(t('units.mwh'))}`)}
    ${row('map.tooltip.dst_energy', `${fmt(ts.energia_aggiuntiva_destinazione_mwh, 4)} ${esc(t('units.mwh'))}`)}
    ${row('map.tooltip.src_price', `${fmt(ts.prezzo_sorgente_eur_mwh, 1)} ${esc(t('units.eur_mwh'))}`)}
    ${row('map.tooltip.dst_price', `${fmt(ts.prezzo_destinazione_eur_mwh, 1)} ${esc(t('units.eur_mwh'))}`)}
    ${row('map.tooltip.reward', `${fmt(ts.remunerazione_flessibilita_eur_mwh, 0)} ${esc(t('units.eur_mwh'))}`)}
    ${row('map.tooltip.balance', `${fmt(ts.saldo_eur, 2, { signDisplay:'exceptZero' })} ${esc(t('units.eur'))}`)}
    ${M.kw > 0 ? row('map.tooltip.it_load', `${fmt(M.kw, 1)} ${esc(t('units.kw'))}`) : ''}
    <tr><td></td><td class="outcome ${ok ? 'd-good' : 'd-bad'}">${esc(t(ok ? 'map.tooltip.accepted' : 'map.tooltip.rejected'))}</td></tr></table>
    <p>${esc(t('map.tooltip.rule'))}</p>`;
  tip.hidden = false;
  const stage = $('.map__stage').getBoundingClientRect(), mid = M.pathMR.getPointAtLength(M.lenMR / 2);
  const ctm = $('#netMap').getScreenCTM();
  const sx = ctm.a * mid.x + ctm.e - stage.left, sy = ctm.d * mid.y + ctm.f - stage.top;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = clamp(sx + 20, 8, stage.width - w - 8) + 'px';
  tip.style.top = clamp(sy - h / 2, 8, stage.height - h - 8) + 'px';
}

/* ---------- architecture ---------- */
const A = { sel:'orchestrator', flows:[] };
function buildArch() {
  $$('.arch__block').forEach(b => b.addEventListener('click', () => { A.sel = b.dataset.layer; renderArchPanel(); }));
  $('#archClose').addEventListener('click', () => { A.sel = null; renderArchPanel(); });
  new ResizeObserver(drawWires).observe($('#archDiagram'));
  renderArchPanel();
}
function renderArchPanel() {
  $$('.arch__block').forEach(b => { b.classList.toggle('is-sel', b.dataset.layer === A.sel); b.setAttribute('aria-pressed', String(b.dataset.layer === A.sel)); });
  const p = $('#archPanel');
  p.classList.toggle('is-empty', !A.sel);
  $('#archClose').hidden = !A.sel;
  const h = $('#archPanelTitle');
  if (!A.sel) { h.dataset.i18n = 'arch.intro'; h.style.cssText = 'font-family:var(--f-body);font-weight:500;font-size:15px;color:var(--muted)'; }
  else { h.dataset.i18n = `arch.layers.${A.sel}.title`; h.style.cssText = ''; }
  $('#archFn').dataset.i18n = `arch.layers.${A.sel || 'field'}.function`;
  $('#archIn').dataset.i18n = `arch.layers.${A.sel || 'field'}.inputs`;
  $('#archOut').dataset.i18n = `arch.layers.${A.sel || 'field'}.outputs`;
  translate(p);
}
function drawWires() {
  const svg = $('#archWires'), box = $('#archDiagram').getBoundingClientRect();
  if (getComputedStyle(svg).display === 'none') return;
  const R = {};
  $$('.arch__block').forEach(b => { const r = b.getBoundingClientRect(); R[b.dataset.layer] = { l:r.left - box.left, r:r.right - box.left, t:r.top - box.top, b:r.bottom - box.top, cx:(r.left + r.right) / 2 - box.left, cy:(r.top + r.bottom) / 2 - box.top, w:r.width, h:r.height }; });
  const pr = $('#archPrice').getBoundingClientRect();
  const P = { l:pr.left - box.left, r:pr.right - box.left, t:pr.top - box.top, cx:(pr.left + pr.right) / 2 - box.left };
  const { field:f, twin:tw, simulator:si, orchestrator:o, aggregator:ag, grid:g } = R;
  const pl = (...pts) => 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L');
  const mxL = (f.r + Math.min(tw.l, o.l)) / 2, mxR = (Math.max(si.r, ag.r) + g.l) / 2, gy = (si.b + ag.t) / 2;
  const W = [
    [pl([f.r, f.cy - 12], [mxL - 7, f.cy - 12], [mxL - 7, tw.cy], [tw.l, tw.cy]), 'main'],
    [pl([o.l, o.cy], [mxL + 7, o.cy], [mxL + 7, f.cy + 12], [f.r, f.cy + 12]), 'main'],
    [pl([tw.r, tw.cy], [si.l, si.cy]), 'thin'],
    [pl([si.l + si.w * 0.25, si.b], [si.l + si.w * 0.25, gy], [o.l + o.w * 0.72, gy], [o.l + o.w * 0.72, o.t]), 'thin'],
    [pl([si.l + si.w * 0.7, si.b], [si.l + si.w * 0.7, ag.t]), 'thin'],
    [pl([ag.r, ag.cy - 12], [mxR - 7, ag.cy - 12], [mxR - 7, g.cy - 12], [g.l, g.cy - 12]), 'main'],
    [pl([g.l, g.cy + 12], [mxR + 7, g.cy + 12], [mxR + 7, ag.cy + 12], [ag.r, ag.cy + 12]), 'main'],
    [pl([ag.l, ag.cy], [o.r, o.cy]), 'thin'],
    [pl([P.l + 16, P.t], [P.l + 16, (P.t + o.b) / 2], [o.cx, (P.t + o.b) / 2], [o.cx, o.b]), 'dispatch'],
    [pl([P.r - 16, P.t], [P.r - 16, (P.t + ag.b) / 2 + 6], [ag.cx, (P.t + ag.b) / 2 + 6], [ag.cx, ag.b]), 'valuation']
  ];
  const ST = { main:[C.navy, 5, 'aN', ''], thin:[C.navy, 2.2, 'aN', ''], dispatch:[C.deep, 3, 'aG', ''], valuation:[C.sage, 3, 'aS', '6 5'] };
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  svg.innerHTML = `<defs>
    <marker id="aN" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${C.navy}"/></marker>
    <marker id="aG" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${C.deep}"/></marker>
    <marker id="aS" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${C.sage}"/></marker></defs>` +
    W.map(([d, k]) => { const [c, w, m, da] = ST[k]; return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round" ${da ? `stroke-dasharray="${da}"` : ''} marker-end="url(#${m})"/>`; }).join('') +
    W.filter(([, k]) => k !== 'valuation').map(([d, k]) => `<path class="flow" d="${d}" fill="none" stroke="${C.neon}" stroke-width="${k === 'main' ? 2 : 1.6}" stroke-linecap="round" stroke-dasharray="2 16" opacity=".95"/>`).join('');
  A.flows = $$('.flow', svg);
  if (reduced) A.flows.forEach(p => p.remove());
}
function archFrame(ts) { const o = String(-(ts / 40) % 18); A.flows.forEach(p => p.setAttribute('stroke-dashoffset', o)); }

/* ---------- levers ---------- */
const LEVER_ICONS = { temporal:'i-clock', spatial:'i-route', bess:'i-battery', hvac:'i-thermo', pv:'i-solar' };
function buildLevers() {
  const g = $('#leversGrid');
  g.innerHTML = Object.keys(LEVER_ICONS).map(k => {
    const scope = get(D.it, `levers.items.${k}.scope`);
    const b = (scope === 'flex' || scope === 'both' ? `<span class="bdg bdg--flex">${i18nSpan('levers.badge_flex')}</span>` : '') +
              (scope === 'eff' || scope === 'both' ? `<span class="bdg bdg--eff">${i18nSpan('levers.badge_eff')}</span>` : '');
    return `<article class="lever"><div class="lever__top"><svg class="icon" aria-hidden="true"><use href="#${LEVER_ICONS[k]}"/></svg><div class="badges">${b}</div></div>
      <h3>${i18nSpan(`levers.items.${k}.title`)}</h3>
      <dl><div><dt>${i18nSpan('levers.principle')}</dt><dd>${i18nSpan(`levers.items.${k}.principle`)}</dd></div>
      <div><dt>${i18nSpan('levers.response')}</dt><dd class="resp">${i18nSpan(`levers.items.${k}.response`)}</dd></div>
      <div><dt>${i18nSpan('levers.constraints')}</dt><dd>${i18nSpan(`levers.items.${k}.constraints`)}</dd></div></dl></article>`;
  }).join('');
}

/* ---------- objectives ---------- */
const OBJ = ['cue','pv','trl','payback','irr','duration'];
let objP = reduced ? 1 : 0, objStarted = false;
function objText(str, p) {
  const nums = [...str.matchAll(/\d+(?:[.,]\d+)?/g)];
  if (!nums.length || p >= 1) return str;
  const last = nums[nums.length - 1], target = parseFloat(last[0].replace(',', '.'));
  const from = nums.length > 1 ? parseFloat(nums[0][0]) : 0;
  const v = Math.round(from + (target - from) * p);
  return str.slice(0, last.index) + v + str.slice(last.index + last[0].length);
}
function buildObjectives() {
  $('#objGrid').innerHTML = OBJ.map(k => `<div class="obj"><div class="obj__v" data-obj="${k}"></div><div class="obj__l">${i18nSpan(`objectives.items.${k}.label`)}</div></div>`).join('');
  renderObjectives();
}
function renderObjectives() { $$('[data-obj]').forEach(n => { n.textContent = objText(t(`objectives.items.${n.dataset.obj}.value`), objP); }); }
function startCounters() {
  if (objStarted || reduced) return; objStarted = true;
  const t0 = performance.now();
  const step = now => { const q = clamp((now - t0) / 1400, 0, 1); objP = 1 - Math.pow(1 - q, 3); renderObjectives(); if (q < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ---------- roadmap ---------- */
const DELIV = [['D1_1',1,'mare',12],['D1_2',1,'stam',12],['D1_3',1,'cnit',18],['D1_4',1,'exprivia',12],['D1_5',1,'smarttrack',12],
  ['D2_1',2,'mare',24],['D2_2',2,'stam',24],['D2_3',2,'exprivia',24],['D2_4',2,'cnit',24],['D2_5',2,'smarttrack',24],
  ['D3_1',3,'mare',27],['D3_2',3,'stam',27],['D3_3',3,'exprivia',27],['D3_4',3,'cnit',29],
  ['D4_1',4,'mare',30],['D4_2',4,'cnit',30]].map(([id, wp, p, m]) => ({ id, wp, p, m }));
const RMS = { sel:null, cur:0 };
function monthNow() {
  const s = new Date(CONFIG.projectStart + 'T00:00:00'), n = new Date();
  return (n.getFullYear() - s.getFullYear()) * 12 + (n.getMonth() - s.getMonth()) + (n.getDate() - 1) / 30.4375;
}
function monthEnd(m) { const s = new Date(CONFIG.projectStart + 'T00:00:00'); return new Date(Date.UTC(s.getFullYear(), s.getMonth() + m, 0)); }
function buildRoadmap() {
  const now = monthNow(); RMS.cur = Math.floor(now) + 1;
  const next = Math.min(...DELIV.filter(d => d.m >= RMS.cur).map(d => d.m));
  const N = CONFIG.months;
  let html = `<div class="rm-row rm-row--head"><div class="rm-lab"></div><div class="rm-area rm-months" style="grid-template-columns:repeat(${N},1fr)">${
    Array.from({ length:N }, (_, i) => `<span class="${i + 1 === RMS.cur ? 'is-now' : ''}">${i18nSpan('roadmap.month', { n:i + 1 })}</span>`).join('')}</div></div>`;
  [1,2,3,4].forEach(wp => {
    const items = DELIV.filter(d => d.wp === wp).sort((a, b) => a.m - b.m), rows = [];
    items.forEach(d => { let r = rows.findIndex(last => d.m - last >= 4); if (r < 0) { r = rows.length; rows.push(0); } rows[r] = d.m; d.row = r; });
    html += `<div class="rm-row"><div class="rm-lab mono">${i18nSpan('roadmap.wp', { n:wp })}</div><div class="rm-area" style="height:${rows.length * 34 + 14}px">${
      items.map(d => {
        const st = d.m < RMS.cur ? 'past' : d.m === next ? 'next' : 'future';
        const edge = d.m >= N - 1 ? ' is-end' : '';
        return `<button type="button" class="rm-chip rm-chip--${st}${edge}" data-dl="${d.id}" style="left:${d.m / N * 100}%;top:${7 + d.row * 34}px">${i18nSpan(`roadmap.deliverables.${d.id}.code`, null, 'mono')}${i18nSpan(`consortium.partners.${d.p}.name`, null, 'rm-chip__p')}</button>`;
      }).join('')}</div></div>`;
  });
  if (now >= 0 && now <= N) html += `<div class="rm-today" style="left:calc(64px + (100% - 64px) * ${now / N})"><span>${i18nSpan('roadmap.today_month', { n:RMS.cur })}</span></div>`;
  const tr = $('#roadmapTrack'); tr.innerHTML = html;
  $$('.rm-chip', tr).forEach(b => b.addEventListener('click', () => { RMS.sel = b.dataset.dl; renderRmDetail(); }));
  $('#rmLegend').innerHTML = [['past','legend_past'],['next','legend_next'],['future','legend_future']]
    .map(([k, l]) => `<span><i class="rm-sw rm-chip--${k}"></i>${i18nSpan('roadmap.' + l)}</span>`).join('');
  RMS.sel = (DELIV.find(d => d.m === next) || DELIV[0]).id;
  setTimeout(() => { const sc = $('.roadmap__scroll'); sc.scrollLeft = Math.max(0, (tr.scrollWidth - 64) * (now / N) + 64 - sc.clientWidth / 2); }, 400);
  renderRmDetail();
}
function renderRmDetail() {
  $$('.rm-chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dl === RMS.sel)));
  const d = DELIV.find(x => x.id === RMS.sel), box = $('#rmDetail');
  if (!d) { box.innerHTML = `<p class="note">${i18nSpan('roadmap.select_hint')}</p>`; translate(box); return; }
  const k = `roadmap.deliverables.${d.id}`;
  const date = new Intl.DateTimeFormat(locale(), { month:'long', year:'numeric', timeZone:'UTC' }).format(monthEnd(d.m));
  box.innerHTML = `<div class="rm-detail__head"><span class="rm-detail__code mono">${i18nSpan(k + '.code')}</span><h3>${i18nSpan(k + '.title')}</h3></div>
    <dl class="rm-detail__grid">
      <div><dt>${i18nSpan('roadmap.detail.partner')}</dt><dd>${i18nSpan(`consortium.partners.${d.p}.name`)}</dd></div>
      <div><dt>${i18nSpan('roadmap.detail.due')}</dt><dd class="mono">${i18nSpan('roadmap.month', { n:d.m })} · ${esc(date)}</dd></div>
      <div><dt>${i18nSpan('roadmap.detail.type')}</dt><dd>${i18nSpan(k + '.type')}</dd></div>
      <div><dt>${i18nSpan('roadmap.detail.la')}</dt><dd class="mono">${i18nSpan(k + '.la')}</dd></div>
      <div class="is-wide"><dt>${i18nSpan('roadmap.detail.check')}</dt><dd>${i18nSpan(k + '.check')}</dd></div>
    </dl>`;
  translate(box);
}

/* ---------- consortium ---------- */
const PARTNERS = ['mare','stam','cnit','exprivia','smarttrack'];
const LOGOS = {
  mare:'logos/Solo-Bianco.webp',
  stam:'logos/stam-logo-alt.png',
  cnit:'logos/Logo_Blu_Trasparente-sc.png',
  exprivia:'logos/LogoExprivia_ventennale-400x94.webp',
  smarttrack:'logos/Logo_smart_track_trasparente.png'
};
const CAR = { i:0, paused:false };
function buildCarousel() {
  const tr = $('#carTrack');
  tr.innerHTML = PARTNERS.map((k, i) => `<article class="partner" role="group" aria-roledescription="slide" data-slide="${i}">
    <img class="partner-logo${k === 'mare' ? ' partner-logo--on-dark' : ''}" data-logo="${k}" src="${LOGOS[k]}" alt="">
    <h3>${i18nSpan(`consortium.partners.${k}.name`)}</h3>
    <p>${i18nSpan(`consortium.partners.${k}.role`)}</p>
    <div class="focus">${i18nSpan('consortium.focus')}<b>${i18nSpan(`consortium.partners.${k}.focus`)}</b></div></article>`).join('');
  const car = $('#carousel');
  $('#carPrev').addEventListener('click', () => go(-1));
  $('#carNext').addEventListener('click', () => go(1));
  car.addEventListener('mouseenter', () => { CAR.paused = true; }); car.addEventListener('mouseleave', () => { CAR.paused = false; });
  car.addEventListener('focusin', () => { CAR.paused = true; }); car.addEventListener('focusout', () => { CAR.paused = false; });
  car.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { go(1); e.preventDefault(); } if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); } });
  addEventListener('resize', () => go(0));
  if (!reduced) setInterval(() => { if (!CAR.paused && vis.consortium && !document.hidden) go(1); }, 6000);
  go(0);
}
function perView() { return innerWidth <= 620 ? 1 : innerWidth <= 980 ? 2 : 3; }
function go(d) {
  const max = PARTNERS.length - perView();
  CAR.i = CAR.i + d > max ? 0 : CAR.i + d < 0 ? max : CAR.i + d;
  const card = $('.partner'); if (!card) return;
  const gap = parseFloat(getComputedStyle($('#carTrack')).gap) || 22;
  $('#carTrack').style.transform = `translateX(${-CAR.i * (card.offsetWidth + gap)}px)`;
  $$('.partner').forEach((p, i) => { const inView = i >= CAR.i && i < CAR.i + perView(); p.setAttribute('aria-hidden', String(!inView)); p.inert = !inView; });
}

/* ---------- misc ---------- */
function refreshDynamic() {
  if (!DATA) return;
  syncControls(); renderKPI(); S.lastI = -1; S.chartDirty = true; drawChart();
  renderObjectives(); fitLabels(); if (RMS.sel) renderRmDetail();
  $('#rights').dataset.i18nArgs = JSON.stringify({ year:new Date().getFullYear() }); translate($('#rights'));
  $$('.partner').forEach((p, i) => p.setAttribute('aria-label', t('consortium.slide', { n:i + 1, tot:PARTNERS.length })));
  $$('[data-logo]').forEach(n => { n.alt = t('consortium.logo_alt', { name:t(`consortium.partners.${n.dataset.logo}.name`) }); });
  const mb = $('#menuBtn'); mb.dataset.i18nAttr = `aria-label:${mb.getAttribute('aria-expanded') === 'true' ? 'nav.menu_close' : 'nav.menu_open'}`; translate(mb.parentNode);
  if (M.nodes) updateMapState(clamp(Math.floor(S.idx), 0, 287));
}
function initNav() {
  const mb = $('#menuBtn'), nav = $('#nav');
  mb.addEventListener('click', () => {
    const open = mb.getAttribute('aria-expanded') !== 'true';
    mb.setAttribute('aria-expanded', String(open)); nav.classList.toggle('is-open', open);
    mb.dataset.i18nAttr = `aria-label:${open ? 'nav.menu_close' : 'nav.menu_open'}`; translate(mb.parentNode);
  });
  nav.addEventListener('click', e => { if (e.target.closest('a')) { mb.setAttribute('aria-expanded', 'false'); nav.classList.remove('is-open'); } });
  $$('.lang button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
  const setTop = () => document.documentElement.style.setProperty('--top', $('#topbar').offsetHeight + 'px');
  new ResizeObserver(setTop).observe($('#topbar'));
}

async function init() {
  initNav();
  try {
    const [it, en, data] = await Promise.all([
      loadJSON('i18n/it.json', 'i18n-it', 'it'), loadJSON('i18n/en.json', 'i18n-en', 'en'), loadJSON('data/flexidata_mock_data.json', 'data', 'data')
    ]);
    D.it = it; D.en = en; DATA = data;
  } catch (e) {
    console.error('[FLEXIDATA] failed to load dictionaries or data', e);
    const p = document.createElement('p');
    p.className = 'boot-error';
    p.textContent = 'Impossibile caricare i contenuti della pagina.';
    document.body.prepend(p);
    return;
  }
  S.lang = pickLang();
  prepData();
  buildSimUI(); buildArch(); buildLevers(); buildObjectives(); buildRoadmap(); buildCarousel(); initTips();
  document.documentElement.lang = S.lang;
  renderLegend();
  setLang(S.lang);
  sizeCanvas();
  observe();
  const outline = await loadItaly();
  buildHero(outline); buildMap(outline);
  drawWires();
  onInterval(); drawChart();
  requestAnimationFrame(frame);
}
init();
})();
