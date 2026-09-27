// Recalcula el hash SHA-256 del <script> en línea de app/index.html y lo escribe
// en la meta Content-Security-Policy. Ejecutar tras cada cambio del JavaScript:
//   node tools/build-csp.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = new URL('../app/index.html', import.meta.url);
let html = readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error(`Se esperaba 1 script en línea, hay ${scripts.length}`);
const hash = createHash('sha256').update(scripts[0][1], 'utf8').digest('base64');
html = html.replace(/script-src 'sha256-[^']*'/, `script-src 'sha256-${hash}'`);
writeFileSync(file, html);
console.log(`CSP script-src 'sha256-${hash}'`);
