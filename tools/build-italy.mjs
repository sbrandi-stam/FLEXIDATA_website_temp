// Precomputes the Italy outline drawn by the hero and the node map, so the page
// needs neither d3/topojson nor a runtime fetch of world-atlas.
// Usage: node tools/build-italy.mjs  ->  writes assets/italy-outline.js
import { writeFileSync } from 'node:fs';

const ATLAS = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
// keep in sync with the projection in assets/app.js ("geography")
const BB = { lon0:6.4, lon1:18.8, lat0:36.4, lat1:47.2 }, VW = 400, VH = 460, PAD = 14;
const mx = lon => lon * Math.PI / 180, my = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const PX0 = mx(BB.lon0), PX1 = mx(BB.lon1), PY0 = my(BB.lat0), PY1 = my(BB.lat1);
const PS = Math.min((VW - 2 * PAD) / (PX1 - PX0), (VH - 2 * PAD) / (PY1 - PY0));
const POX = (VW - (PX1 - PX0) * PS) / 2, POY = (VH - (PY1 - PY0) * PS) / 2;
const proj = ([lon, lat]) => [POX + (mx(lon) - PX0) * PS, POY + (PY1 - my(lat)) * PS];

const topo = await (await fetch(ATLAS)).json();
const { scale:[sx, sy], translate:[tx, ty] } = topo.transform;
const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
const arc = i => (i < 0 ? arcs[~i].slice().reverse() : arcs[i]);
const geom = topo.objects.countries.geometries.find(g => g.id === '380');
const polys = geom.type === 'Polygon' ? [geom.arcs] : geom.arcs;
const r = v => +v.toFixed(1);
let d = '';
polys.forEach(rings => rings.forEach(ring => {
  const pts = [];
  ring.forEach((ai, k) => { const a = arc(ai); pts.push(...(k ? a.slice(1) : a)); });
  d += pts.map((p, k) => { const [x, y] = proj(p); return (k ? 'L' : 'M') + r(x) + ',' + r(y); }).join('') + 'Z';
}));
writeFileSync(new URL('../assets/italy-outline.js', import.meta.url),
  `/* Generato da tools/build-italy.mjs (world-atlas 2.0.2, countries-110m). */\nwindow.__FLEX_ITALY__=${JSON.stringify(d)};\n`);
console.log('italy-outline.js', d.length, 'chars');
