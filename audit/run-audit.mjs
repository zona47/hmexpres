// Auditoría automatizada de app/index.html. Uso: npm run audit
// Sale con código 1 si falla cualquier comprobación. Resultados en audit/resultados.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { HtmlValidate } from 'html-validate';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'app', 'index.html');
const SHOTS = join(ROOT, 'audit', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const ref = JSON.parse(readFileSync(join(ROOT, 'audit', 'excel_reference.json'), 'utf8'));
const html = readFileSync(APP, 'utf8');

const results = [];
function check(area, name, ok, detail = '') {
  results.push({ area, name, ok: !!ok, detail: String(detail).slice(0, 2000) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail && !ok ? ' → ' + String(detail).slice(0, 300) : ''}`);
}
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= Math.max(1e-9, rel * Math.abs(b));

/* ---------- 1. Estático ---------- */
const hv = new HtmlValidate({ extends: ['html-validate:recommended'], rules: { 'no-inline-style': 'off', 'long-title': 'off', 'prefer-native-element': 'off', 'no-redundant-role': 'off' } });
const report = await hv.validateString(html, 'app/index.html');
const msgs = report.results.flatMap(r => r.messages.map(m => `${m.line}:${m.column} ${m.ruleId} ${m.message}`));
check('HTML', 'html-validate sin errores', report.valid, msgs.join('\n'));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const hash = createHash('sha256').update(script, 'utf8').digest('base64');
check('Seguridad', 'Hash CSP coincide con el script en línea', html.includes(`'sha256-${hash}'`));
check('Seguridad', 'Sin innerHTML / outerHTML / insertAdjacentHTML / document.write / eval', !/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(script));
const ext = [...html.matchAll(/(?:src|href)\s*=\s*"(https?:[^"]+)"/g)].map(m => m[1]);
check('Seguridad', 'Sin recursos externos (todo en línea, funciona sin red)', ext.length === 0, ext.join(', '));
check('Seguridad', 'CSP bloquea conexiones, formularios y base-uri', /connect-src 'none'/.test(html) && /form-action 'none'/.test(html) && /base-uri 'none'/.test(html));

/* ---------- 2. Servidor local ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let f = join(ROOT, p); if (f.endsWith('/') || !extname(f)) f = join(f, 'index.html');
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try { const b = readFileSync(f); res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_APP = `http://127.0.0.1:${server.address().port}/app/`;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const problems = [];
async function newPage(ctxOpts = {}, init) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...ctxOpts });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'resultado de prueba' : undefined));
  await page.goto(URL_APP);
  return { ctx, page };
}

/* ---------- 3. Paridad con el Excel ---------- */
{
  const { ctx, page } = await newPage();
  const out = await page.evaluate(() => { const M = window.AndromedaModel; const d = M.defaults(); return { d, o: M.compute(d) }; });
  let bad = [];
  for (const [k, v] of Object.entries(ref.expected)) {
    const got = out.o[k];
    if (typeof v === 'number' ? !(typeof got === 'number' && near(got, v)) : got !== v) bad.push(`${k}: Excel=${JSON.stringify(v)} app=${JSON.stringify(got)}`);
  }
  check('Paridad Excel', `${Object.keys(ref.expected).length} fórmulas reproducen el valor del Excel`, bad.length === 0, bad.join('\n'));
  bad = [];
  for (const [k, v] of Object.entries(ref.inputs)) if (out.d[k] !== v.v) bad.push(`${k}: Excel=${v.v} app=${out.d[k]}`);
  check('Paridad Excel', `${Object.keys(ref.inputs).length} entradas por defecto iguales al Excel`, bad.length === 0, bad.join('\n'));
  // Recalculo con otros supuestos: la cadena de dependencias debe seguir la del Excel
  const r2 = await page.evaluate(() => { const M = window.AndromedaModel; const d = M.defaults(); d['Supuestos!D21'] = 0.12; d['Supuestos!D64'] = 200; return M.compute(d); });
  const aov = 603.9, net = aov * 0.88, cm1 = net - (net * 0.045 + 0.3 * 1.62) - net * 0.07;
  check('Paridad Excel', 'Recalcula CM1 con reembolso 12 % (cálculo manual independiente)', near(r2['Economia Unitaria!D19'], cm1, 1e-12), `${r2['Economia Unitaria!D19']} vs ${cm1}`);
  check('Paridad Excel', 'Recalcula aMER con CAC 200', near(r2['Economia Unitaria!D27'], cm1 / 200, 1e-12));

  /* ---------- 4. Cifras citadas en el Playbook ---------- */
  const o = out.o, E = 'Economia Unitaria!', X = 'Escalado!';
  const r1 = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  const pb = [
    ['AOV bruto 603,9', r1(o[E + 'D13']) === 603.9], ['CM1 485,9', r1(o[E + 'D19']) === 485.9], ['CM12 591,1', r1(o[E + 'D21']) === 591.1],
    ['aMER 2,70x', r1(o[E + 'D27'], 2) === 2.7], ['LTV:CAC 3,28x', r1(o[E + 'D28'], 2) === 3.28], ['MER de break-even 1,24x', r1(o[E + 'D32'], 2) === 1.24],
    ['MER objetivo 3,36x (Excel 3,355)', r1(o[E + 'D31'], 2) === 3.36], ['Índice de validación 80,8 → GO', r1(o['Validacion!D26']) === 80.8 && o['Validacion!F26'] === 'GO'],
    ['Inversión 12 m 545.482', Math.round(o[X + 'F29']) === 545482], ['Contribución 12 m 1.495.945', Math.round(o[X + 'M29']) === 1495945],
    ['Clientes 12 m 3.079', Math.round(o[X + 'O29']) === 3079], ['ROI acumulado mes 12 1,74x', r1(o[X + 'N29'], 2) === 1.74],
    ['Pico ROI 1,93x en meses 7-8', r1(o[X + 'N24'], 2) === 1.93 && r1(o[X + 'N25'], 2) === 1.93],
    ['ROI sobre LTV 2,34x', r1(o[X + 'O29'] * o[E + 'D21'] / o[X + 'F29'] - 1, 2) === 2.34],
    ['Punto óptimo 1.000 USD/día → 2,95x, CAC 165 (Escalar)', Math.round(o[X + 'E39']) === 165 && o[X + 'F39'] === 'Escalar'],
    ['9.000 USD/día → Apagar', o[X + 'F46'] === 'Apagar']
  ];
  pb.forEach(([n, ok]) => check('Coherencia Playbook', n, ok));

  /* ---------- 5. Reglas de decisión de los documentos ---------- */
  const rules = await page.evaluate(() => {
    const M = window.AndromedaModel, I = M.defaults();
    const w = (o) => M.weeklyDecision(Object.assign({ gasto: 1000, gastoAnt: 800, ingreso: 3500, contrib: 2900, contribAnt: 2300, emq: 8, freq: 2, ctrDrop: 0.05, dias: 10, conv: 80 }, o), I);
    return {
      corte: [M.corteVeredicto(2.5, I), M.corteVeredicto(2.4, I), M.corteVeredicto(62000 / 30000, I), M.corteVeredicto(1.2, I), M.corteVeredicto(1.19, I)],
      marg: w({}).zoneB, margVal: w({}).amerMarg, emq: w({ emq: 6.5 }).blocked, learnDias: w({ dias: 5 }).learning, learnConv: w({ conv: 30 }).learning,
      reduce: w({ contrib: 2300 + 200 * 1.8 }), apagar: w({ contrib: 2300 + 200 * 1.2 }).zoneB, mantener: w({ contrib: 2300 + 200 * 2.5 }).zoneB,
      noInc: w({ gastoAnt: 1000 }).marginalApplies, elite: w({ contrib: 2300 + 200 * 3.7 }).zoneB,
      merZ: w({}).zoneMer, amerZ: w({}).zoneAmer, sat: w({ freq: 3.2 }).saturacion, fat: w({ ctrDrop: 0.12 }).fatiga,
      al: [M.alertStatus('cac', 1.3), M.alertStatus('cac', 1.6), M.alertStatus('emq', 6.5), M.alertStatus('emq', 5.9), M.alertStatus('optin', 0.19), M.alertStatus('optin', 0.13), M.alertStatus('reemb', 0.10), M.alertStatus('mer', 3.0), M.alertStatus('dias', 22)],
      arr: M.arrCalc({ precio: 497, bump: 31, up: 53, reemb: 0.10, com: 0.045, cost: 0.10, objPct: 0.6 }),
      d7: [M.d7Verdict(600, 500), M.d7Verdict(500, 500), M.d7Verdict(250, 500), M.d7Verdict(249, 500), M.d7Verdict(100, 0)].map(v => v && v[2]),
      d21: [M.d21Verdict(200, 263.19, 438.66), M.d21Verdict(280, 263.19, 438.66), M.d21Verdict(350, 263.19, 438.66), M.d21Verdict(450, 263.19, 438.66)].map(v => v[0])
    };
  });
  check('Reglas', 'Calculadora de corte (Playbook §5.6): 2,5 / 2,4 / 2,07 / 1,2 / 1,19', JSON.stringify(rules.corte) === JSON.stringify(['Continuar', 'Continuar', 'Pausar y reestructurar', 'Pausar y reestructurar', 'Apagar']), JSON.stringify(rules.corte));
  check('Reglas', 'aMER marginal = Δcontribución ÷ Δgasto (600/200 = 3,0 → Escalar)', near(rules.margVal, 3) && rules.marg === 'Escalar');
  check('Reglas', 'Nivel B: 1,8 → Reducir con gasto −30 %', rules.reduce.zoneB === 'Reducir' && near(rules.reduce.nextBudget, 700));
  check('Reglas', 'Nivel B: 1,2 → Apagar · 2,5 → Mantener · 3,7 → Élite', rules.apagar === 'Apagar' && rules.mantener === 'Mantener' && rules.elite === 'Elite');
  check('Reglas', 'Sin incremento de gasto el aMER marginal no aplica', rules.noInc === false);
  check('Reglas', 'EMQ < 7 bloquea decisiones', rules.emq === 'emq');
  check('Reglas', 'Aprendizaje: < 7 días o < 50 conversiones', rules.learnDias && rules.learnConv);
  check('Reglas', 'MER 3,5 → verde · aMER 2,9 → verde', rules.merZ === 'verde' && rules.amerZ === 'verde');
  check('Reglas', 'Frecuencia > 3 = saturación · caída CTR > 10 % = fatiga', rules.sat && rules.fat);
  check('Reglas', 'Alertas Playbook §5.2 (CAC, EMQ, opt-in, reembolso, MER, días)', JSON.stringify(rules.al) === JSON.stringify(['warning', 'critical', 'warning', 'critical', 'warning', 'critical', 'good', 'good', 'critical']), JSON.stringify(rules.al));
  check('Reglas', 'Tarea 4 del arranque: 581 de ingreso → techo ≈ 438,7 (manual: «unos 440»)', near(rules.arr.ingreso, 581) && near(rules.arr.techo, 438.655, 1e-9));
  check('Reglas', 'Tarea 4: objetivo 60 % = 263,2 · 40 % = 175,5', near(rules.arr.objetivo, 263.193, 1e-9) && near(rules.arr.objetivo40, 175.462, 1e-9));
  check('Reglas', 'Día 7: cobrado > gastado / ≥ mitad / < mitad / sin gasto', JSON.stringify(rules.d7) === JSON.stringify(['good', 'warning', 'warning', 'critical', null]), JSON.stringify(rules.d7));
  check('Reglas', 'Día 21: escala / mantén / optimiza / para', JSON.stringify(rules.d21) === JSON.stringify(['Escala', 'Mantén', 'Optimiza una semana más', 'Para']), JSON.stringify(rules.d21));
  await ctx.close();
}

/* ---------- 6. Interfaz ---------- */
{
  const { ctx, page } = await newPage();
  const tabs = await page.$$eval('[role=tab]', ts => ts.map(t => t.id));
  let tabBad = [];
  for (const id of tabs) {
    await page.click('#' + id);
    const ok = await page.evaluate(id => {
      const panels = [...document.querySelectorAll('[role=tabpanel]')];
      const visible = panels.filter(p => getComputedStyle(p).display !== 'none').map(p => p.id);
      return visible.length === 1 && visible[0] === document.getElementById(id).getAttribute('aria-controls') && document.getElementById(id).getAttribute('aria-selected') === 'true';
    }, id);
    if (!ok) tabBad.push(id);
  }
  check('Interfaz', `Las ${tabs.length} pestañas muestran solo su panel`, tabBad.length === 0, tabBad.join(','));
  await page.click('#t-resumen'); await page.focus('#t-resumen'); await page.keyboard.press('ArrowRight');
  check('Interfaz', 'Navegación con flechas entre pestañas', await page.evaluate(() => document.activeElement.id === 't-arranque' && document.getElementById('p-arranque').classList.contains('active')));

  // Editar un supuesto recalcula y persiste
  await page.click('#t-supuestos');
  await page.fill('#in-D21', '12'); await page.press('#in-D21', 'Tab');
  const expCm1 = await page.evaluate(() => { const M = window.AndromedaModel, d = M.defaults(); d['Supuestos!D21'] = 0.12; return M.compute(d)['Economia Unitaria!D19']; });
  const kpiTxt = await page.textContent('#sum-kpis .kpi:first-child .v');
  const fmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(expCm1) + ' USD';
  check('Interfaz', 'Cambiar reembolso a 12 % actualiza el CM1 del resumen', kpiTxt === fmt, `${kpiTxt} vs ${fmt}`);
  await page.reload();
  check('Interfaz', 'El cambio persiste tras recargar (localStorage)', (await page.inputValue('#in-D21')) === '12');
  await page.click('#t-supuestos'); await page.click('#btn-reset');
  check('Interfaz', 'Restablecer vuelve al caso de referencia', (await page.inputValue('#in-D21')) === '9');
  await page.fill('#in-D10', 'abc'); await page.press('#in-D10', 'Tab');
  const inv = await page.evaluate(() => ({ a: document.getElementById('in-D10').getAttribute('aria-invalid'), v: JSON.parse(localStorage.getItem('andromeda2026.v1')).inputs['Supuestos!D10'] }));
  check('Interfaz', 'Entrada no válida se marca y no altera el modelo', inv.a === 'true' && inv.v === 497, JSON.stringify(inv));
  await page.fill('#in-D64', '0'); await page.press('#in-D64', 'Tab');
  check('Interfaz', 'CAC objetivo 0 se rechaza (evita división por cero)', (await page.getAttribute('#in-D64', 'aria-invalid')) === 'true');
  await page.fill('#in-D10', '497'); await page.press('#in-D10', 'Tab');

  // Rutina semanal
  await page.click('#t-rutina');
  for (const [k, v] of Object.entries({ gasto: '1000', gastoAnt: '800', ingreso: '3500', contrib: '2900', contribAnt: '2300', emq: '8', freq: '2', ctrDrop: '5', dias: '10', conv: '80' })) { await page.fill('#wk-' + k, v); await page.press('#wk-' + k, 'Tab'); }
  const t1 = await page.textContent('#rut-out .verdict .t');
  check('Interfaz', 'Rutina: aMER marginal 3,0 sin condiciones marcadas → no escala', /faltan condiciones/.test(t1), t1);
  for (const c of ['verde14', 'ventana', 'emqok', 'lift', 'banco']) await page.check('#cond-' + c);
  const t2 = await page.textContent('#rut-out .verdict .t');
  check('Interfaz', 'Rutina: con las 5 condiciones → escalar hasta 20 %', /Escalar/.test(t2) && /20/.test(t2), t2);
  await page.fill('#wk-emq', '6'); await page.press('#wk-emq', 'Tab');
  check('Interfaz', 'Rutina: EMQ 6 → bloqueo', /repara la señal/.test(await page.textContent('#rut-out .verdict .t')));
  await page.click('#rut-log');
  check('Interfaz', 'Registrar decisión abre el cuaderno precargado', (await page.evaluate(() => document.getElementById('p-cuaderno').classList.contains('active'))) && (await page.inputValue('#log-form [name=decision]')) === 'Pausar');

  // Cuaderno: XSS y CSV
  await page.fill('#log-form [name=ambito]', '<img src=x onerror="window.__xss=1">');
  await page.fill('#log-form [name=hipotesis]', '<script>window.__xss=2</script>');
  await page.click('#log-form button[type=submit]');
  const xss = await page.evaluate(() => ({ imgs: document.querySelectorAll('#log-list img, #log-list script').length, flag: window.__xss, txt: document.getElementById('log-list').textContent.includes('<img src=x') }));
  check('Seguridad', 'Texto del cuaderno se muestra como texto (sin XSS)', xss.imgs === 0 && xss.flag === undefined && xss.txt, JSON.stringify(xss));
  const csv = await page.evaluate(() => window.AndromedaModel.toCSV([{ fecha: '2026-09-27', ambito: '=HYPERLINK("x")', decision: 'Pausar', hipotesis: 'a"b', dato: '+1', resultado: '@x' }]));
  check('Seguridad', 'CSV neutraliza fórmulas (=, +, @) y escapa comillas', csv.includes(`"'=HYPERLINK(""x"")"`) && csv.includes(`"'+1"`) && csv.includes(`"'@x"`) && csv.includes('"a""b"'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#log-csv')]);
  check('Interfaz', 'Exportar CSV descarga cuaderno-decisiones.csv', dl.suggestedFilename() === 'cuaderno-decisiones.csv');
  await page.click('.log-entry button:text("Anotar resultado")');
  check('Interfaz', 'Anotar resultado a 30 días', (await page.textContent('#log-list')).includes('resultado de prueba'));
  await page.click('.log-entry button:text("Eliminar")');
  check('Interfaz', 'Eliminar registro (con confirmación)', (await page.$$('.log-entry')).length === 0);

  // Importación maliciosa
  const san = await page.evaluate(() => window.AndromedaModel.sanitize(JSON.parse('{"inputs":{"Supuestos!D10":"<script>","Supuestos!D11":1e400,"evil":5,"Supuestos!D21":0.1},"__proto__":{"polluted":1},"log":[{"hipotesis":{"a":1},"fecha":"2026-01-01"}],"weeks":[{"semana":"x","gasto":1,"cobrado":1,"clientes":1},{"semana":"2026-01-05","gasto":-5,"cobrado":1,"clientes":1}],"conds":{"lift":"yes"},"arr":{"precio":-3,"quien":"ok"}}')));
  check('Seguridad', 'Importación: descarta tipos no válidos, claves desconocidas y prototipos', san.inputs['Supuestos!D10'] === 497 && san.inputs['Supuestos!D11'] === 561 && san.inputs['Supuestos!D21'] === 0.1 && !('evil' in san.inputs) && san.log[0].hipotesis === '' && san.weeks.length === 0 && !san.conds.lift && !('precio' in san.arr) && san.arr.quien === 'ok' && ({}).polluted === undefined, JSON.stringify(san).slice(0, 300));

  // Arranque y prueba de 21 días
  await page.click('#t-arranque');
  await page.fill('#arr-quien', 'emprendedores'); await page.fill('#arr-resultado', 'vender más');
  const aw = await page.textContent('#arr-promesa-warn');
  check('Interfaz', 'Promesa: avisa de público amplio y resultado sin cifra', /demasiado amplio/.test(aw) && /cifra/.test(aw));
  check('Interfaz', 'Garantía se genera con el resultado de la promesa', (await page.textContent('#arr-garantia')).includes('vender más'));
  const techo = await page.textContent('#arr-calc-out .kpi:nth-child(3) .v');
  check('Interfaz', 'Tarea 4 con el ejemplo del manual → techo 438,7 USD', techo === '438,7 USD', techo);
  await page.click('#t-prueba');
  await page.fill('#pr-d7c', '300'); await page.press('#pr-d7c', 'Tab'); await page.fill('#pr-d7g', '420'); await page.press('#pr-d7g', 'Tab');
  check('Interfaz', 'Día 7: 300 cobrado / 420 gastado → interés, falla el cierre', /cierre/.test(await page.textContent('#pr-d7-out')));
  await page.fill('#wk-form [name=semana]', '2026-09-21'); await page.fill('#wk-form [name=gasto]', '140'); await page.fill('#wk-form [name=cobrado]', '1100'); await page.fill('#wk-form [name=clientes]', '2');
  await page.click('#wk-form button[type=submit]');
  const row = await page.textContent('#wk-table tbody tr');
  check('Interfaz', 'Panel de 5 números: coste por cliente 70 USD → Escala', row.includes('70 USD') && row.includes('Escala'), row);
  const d = new Date(); d.setDate(d.getDate() - 9);
  await page.fill('#pr-lanz', d.toISOString().slice(0, 10));
  check('Interfaz', 'Contador de la prueba: lanzamiento hace 9 días → día 10', (await page.textContent('#pr-dia')).includes('Día 10 de 21'));

  // Gráfico
  await page.click('#t-escalado');
  check('Interfaz', 'Curva de escalado: 12 puntos accesibles por teclado', (await page.$$eval('#esc-chart circle[tabindex="0"][aria-label]', c => c.length)) === 12);
  await page.focus('#esc-chart circle');
  check('Interfaz', 'Tooltip al enfocar un punto', await page.evaluate(() => getComputedStyle(document.getElementById('tip')).display === 'block'));
  await ctx.close();
}

/* ---------- 6b. Informe de campaña (CSV de Meta) ---------- */
{
  const FX = join(ROOT, 'audit', 'fixtures');
  const { ctx, page } = await newPage();
  const u = await page.evaluate(() => { const M = window.AndromedaModel; return [M.csvNum('1.755'), M.csvNum('1.234,56'), M.csvNum('1,234.56'), M.csvNum('2,5'), M.csvNum(''), M.csvNum('00:00:00')]; });
  check('Informe CSV', 'Números: 1.755 / 1.234,56 / 1,234.56 / 2,5 / vacío / hora', near(u[0], 1.755) && near(u[1], 1234.56) && near(u[2], 1234.56) && near(u[3], 2.5) && u[4] === 0 && Number.isNaN(u[5]), JSON.stringify(u));
  const pa = await page.evaluate(t => { const r = window.AndromedaModel.parseReport(t, 'a.csv'); const a = window.AndromedaModel.repAgg(r.rows); return { n: r.rows.length, nivel: r.nivel, ini: r.inicio, fin: r.fin, name0: r.rows[0].nombre, a }; }, readFileSync(join(FX, 'meta-diario-2026-09-20.csv'), 'utf8'));
  check('Informe CSV', 'Cabeceras de tu exportación de Meta: 3 filas, nivel conjunto, diario', pa.n === 3 && pa.nivel === 'Conjunto' && pa.ini === '2026-09-20' && pa.fin === '2026-09-20', JSON.stringify(pa).slice(0, 300));
  check('Informe CSV', 'Campos entrecomillados con comas y comillas', pa.name0 === 'Conjunto A, "dolor"', pa.name0);
  check('Informe CSV', 'Totales recalculados (gasto 70,75 · compras 3 · CPM · CTR · CAC)', near(pa.a.gasto, 70.75) && pa.a.compras === 3 && near(pa.a.cpm, 70.75 / 1750 * 1000) && near(pa.a.ctr, 45 / 1750) && near(pa.a.cac, 70.75 / 3) && near(pa.a.roas, 1491 / 70.75), JSON.stringify(pa.a));
  const en = await page.evaluate(t => { const r = window.AndromedaModel.parseReport(t, 'en.csv'); return { r: [r.inicio, r.fin, r.rows.length], a: window.AndromedaModel.repAgg(r.rows) }; }, readFileSync(join(FX, 'meta-acumulado-en.csv'), 'utf8'));
  check('Informe CSV', 'Exportación en inglés, separador «;» y decimales con coma (acumulado)', en.r[0] === '2026-09-01' && en.r[1] === '2026-09-21' && near(en.a.gasto, 2000) && en.a.impr === 150000 && en.a.compras === 10 && near(en.a.valor, 5500), JSON.stringify(en));
  const dg = await page.evaluate(() => { const M = window.AndromedaModel, I = M.defaults(), cm1 = M.compute(I)['Economia Unitaria!D19'];
    const t = M.repAgg([{ gasto: 2000, impr: 150000, alcance: 65000, clics: 2800, lp: 2000, checkouts: 80, compras: 10, valor: 5500 }]);
    const t0 = M.repAgg([{ gasto: 600, impr: 50000, alcance: 20000, clics: 500, lp: 400, checkouts: 5, compras: 0, valor: 0 }]);
    return { d: M.repDiagnose(t, 21, I, cm1), d1: M.repDiagnose(t, 3, I, cm1), d0: M.repDiagnose(t0, 10, I, cm1), cm1 }; });
  check('Informe CSV', 'Diagnóstico: aMER = compras × CM1 ÷ gasto; CAC 200 ≤ 202,4 → zona verde', near(dg.d.amer, 10 * dg.cm1 / 2000) && dg.d.cacZone === 'good');
  check('Informe CSV', 'Diagnóstico: < 7 días o < 50 compras = aprendizaje', dg.d1.learning === true && dg.d.learning === true);
  check('Informe CSV', 'Diagnóstico: gasto > techo sin compras = alerta crítica', dg.d0.sinComprasSobreTecho === true);
  check('Informe CSV', 'Benchmarks: CPM 13,3 media · CTR 1,87 % media · frecuencia 2,3 OK', dg.d.cpm === 'warning' && dg.d.ctr === 'warning' && dg.d.freq === 'good', JSON.stringify(dg.d));

  await page.click('#t-informe');
  await page.setInputFiles('#rep-file', [join(FX, 'meta-diario-2026-09-20.csv'), join(FX, 'meta-diario-2026-09-21.csv')]);
  await page.waitForFunction(() => /filas/.test(document.getElementById('rep-status').textContent) && document.querySelectorAll('input[name=rep-sel]').length === 3);
  check('Informe CSV', 'Carga de 2 informes diarios + opción «suma de diarios»', true);
  await page.check('#rs-daily-sum');
  const ds = await page.evaluate(() => ({ h: document.querySelector('#rep-view h3').textContent, evo: [...document.querySelectorAll('#rep-view caption')].some(c => c.textContent === 'Evolución diaria'), best: ([...document.querySelectorAll('#rep-view .badge')].find(b => b.textContent === 'Mejor') || { closest: () => ({ textContent: '' }) }).closest('td').textContent, imgs: document.querySelectorAll('#rep-view img').length, xss: window.__xss }));
  check('Informe CSV', 'Suma de diarios: periodo 2026-09-20 → 2026-09-21, evolución diaria y mejor conjunto', /2026-09-20 → 2026-09-21/.test(ds.h) && ds.evo && /Conjunto A/.test(ds.best), JSON.stringify(ds));
  check('Seguridad', 'Nombres del CSV se muestran como texto (sin XSS)', ds.imgs === 0 && ds.xss === undefined);
  await page.click('#rep-view button:text("Usar en la rutina semanal")');
  const wk = await page.evaluate(() => JSON.parse(localStorage.getItem('andromeda2026.v1')).weekly);
  check('Informe CSV', 'Enviar a la rutina semanal copia gasto, compras y contribución', near(wk.gasto, 132.75) && wk.conv === 6 && near(wk.ingreso, 2982), JSON.stringify(wk));
  await page.click('#rep-view button:text("Añadir al panel de 5 números")');
  check('Informe CSV', 'Añadir al panel de 5 números', (await page.evaluate(() => JSON.parse(localStorage.getItem('andromeda2026.v1')).weeks.length)) === 1);
  await page.setInputFiles('#rep-file', join(FX, 'no-es-meta.csv'));
  await page.waitForFunction(() => /no-es-meta/.test(document.getElementById('rep-status').textContent));
  check('Informe CSV', 'Archivo que no es de Meta: mensaje claro y no se añade', /Importe gastado/.test(await page.textContent('#rep-status')) && (await page.$$('input[name=rep-sel]')).length === 3);
  await page.reload(); await page.click('#t-informe');
  check('Informe CSV', 'Los informes persisten tras recargar', (await page.$$('input[name=rep-sel]')).length === 3);
  await page.click('#rep-view button:text("Quitar")').catch(() => {});
  await page.click('#rep-list button:text("Quitar")');
  check('Informe CSV', 'Quitar un informe', (await page.$$('input[name=rep-sel]')).length === 1);
  if (process.env.REAL_CSV) {
    await page.setInputFiles('#rep-file', process.env.REAL_CSV);
    await page.waitForFunction(() => /filas/.test(document.getElementById('rep-status').textContent));
    const real = await page.evaluate(() => ({ st: document.getElementById('rep-status').textContent, v: document.querySelector('#rep-view .verdict .t').textContent, k: document.querySelector('#rep-view .kpi .v').textContent }));
    check('Informe CSV', 'CSV real del usuario (10 conjuntos, 27-sep-2026): se carga y se diagnostica', /10 filas/.test(real.st) && real.k === '32,90 USD' && /aprendizaje/.test(real.v), JSON.stringify(real));
    check('Informe CSV', 'CSV real: avisa de 21 pagos iniciados sin compras (revisar evento de compra)', /21 pagos iniciados y ninguna compra/.test(await page.textContent('#rep-view')));
    await page.screenshot({ path: join(SHOTS, 'informe-real.png'), fullPage: true });
  }
  await ctx.close();
}

/* ---------- 7. Sin almacenamiento disponible ---------- */
{
  const before = problems.length;
  const { ctx, page } = await newPage({}, () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado'); } }); });
  const ok = await page.evaluate(() => document.querySelectorAll('#sum-kpis .kpi').length === 6);
  check('Robustez', 'Funciona con localStorage bloqueado (modo privado)', ok && problems.length === before, problems.slice(before).join('\n'));
  await ctx.close();
}

/* ---------- 8. Responsive, accesibilidad y capturas ---------- */
const axeSrc = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
for (const scheme of ['light', 'dark']) {
  for (const vp of [{ w: 360, h: 780 }, { w: 768, h: 1024 }, { w: 1280, h: 900 }]) {
    const { ctx, page } = await newPage({ viewport: { width: vp.w, height: vp.h }, colorScheme: scheme });
    const tabs = await page.$$eval('[role=tab]', ts => ts.map(t => t.id));
    const overflow = [], axeBad = [];
    for (const id of tabs) {
      await page.click('#' + id);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 0) overflow.push(`${id}+${o}px`);
      const nr = await page.evaluate(() => [...document.querySelectorAll('[role=tabpanel].active table input.in')].filter(i => i.getBoundingClientRect().width < 80).length);
      if (nr) overflow.push(`${id}: ${nr} campos estrechos`);
      if (vp.w !== 768) {
        // Se inyecta por CDP (no por <script>) para no chocar con la CSP de la página
        if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(axeSrc);
        const res = await page.evaluate(async () => {
          if (!window.axe) return null;
          const r = await window.axe.run(document, { resultTypes: ['violations'] });
          return r.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
        });
        if (res === null) axeBad.push(`${id}: axe no cargó`); else res.forEach(v => axeBad.push(`${id}: ${v}`));
      }
      if (['t-resumen', 't-economia', 't-escalado', 't-rutina', 't-arranque'].includes(id) && vp.w !== 768)
        await page.screenshot({ path: join(SHOTS, `${scheme}-${vp.w}-${id.slice(2)}.png`), fullPage: true });
    }
    const narrow = await page.evaluate(() => [...document.querySelectorAll('table input.in')].filter(i => i.offsetParent && i.getBoundingClientRect().width < 80).length);
    check('Responsive', `${scheme} ${vp.w}px: campos editables en tablas con ancho legible (≥ 80 px)`, narrow === 0, `${narrow} campos estrechos`);
    check('Responsive', `${scheme} ${vp.w}px: sin scroll horizontal de página en ${tabs.length} pestañas`, overflow.length === 0, overflow.join(', '));
    if (vp.w !== 768) check('Accesibilidad', `${scheme} ${vp.w}px: axe-core sin violaciones`, axeBad.length === 0, [...new Set(axeBad)].join('\n'));
    await ctx.close();
  }
}

/* ---------- 9. Consola ---------- */
const csp = problems.filter(p => /Content Security Policy|Refused to/.test(p));
check('Seguridad', 'Sin violaciones de CSP en consola', csp.length === 0, csp.join('\n'));
const axeInjectionNoise = p => /Refused to execute inline script/.test(p);
check('Consola', 'Sin errores ni avisos de JavaScript', problems.filter(p => !axeInjectionNoise(p)).length === 0, problems.join('\n'));

await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
writeFileSync(join(ROOT, 'audit', 'resultados.json'), JSON.stringify({ fecha: new Date().toISOString(), total: results.length, fallidas: failed.length, results }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones superadas`);
process.exit(failed.length ? 1 : 0);
