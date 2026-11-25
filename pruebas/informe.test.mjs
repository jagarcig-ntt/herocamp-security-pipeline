// node --test pruebas/*.test.mjs    (no gasta uso de Claude Code)
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { escribirInforme, leerFamilia, ocultarClaves, recomendacion } from "../scripts/informe.mjs";

const h = (x = {}) => ({ severity: "MEDIUM", title: "T", location: "a.ts:1", why: "W", action: "A", ...x });
const agente = (family, findings) =>
  JSON.stringify({ is_error: false, result: "```json\n" + JSON.stringify({ family, findings }) + "\n```" });
const informe = (f) => escribirInforme({ proyecto: "p", fecha: "f", familias: [f] });
const r = "Aa1Bb2Cc3Dd4Ee5Ff6"; // relleno: ninguna clave de estas pruebas existe

test("lee la respuesta de un agente y ordena por gravedad", () => {
  const { hallazgos } = leerFamilia(agente(1, [h(), h({ severity: "CRITICAL" })]), 1);
  assert.deepEqual(hallazgos.map((x) => x.severity), ["CRITICAL", "MEDIUM"]);
});

test("sin hallazgos", () => {
  const f = { numero: 1, ...leerFamilia(agente(1, []), 1) };
  assert.equal(recomendacion([f]), "✅ SIN HALLAZGOS GRAVES");
  assert.match(informe(f), /Sin hallazgos en el código revisado/);
});

test("una familia que falla nunca se da por revisada", () => {
  const malos = [
    "",
    "{",
    "null",
    JSON.stringify({ is_error: true, result: "x" }),
    JSON.stringify({ is_error: false, result: "hola" }),
    agente(2, []),
    agente(1, [h({ severity: "LOW" })]),
    agente(1, [h({ why: "" })]),
  ];
  for (const malo of malos) {
    const f = { numero: 1, ...leerFamilia(malo, 1) };
    assert.ok(f.error, malo);
    assert.equal(recomendacion([f]), "⚠️ REVISIÓN INCOMPLETA");
    assert.match(informe(f), /No revisada/);
  }
});

test("F2 siempre avisa de que no ve la base de datos", () => {
  for (const f of [{ numero: 2, hallazgos: [] }, { numero: 2, hallazgos: [h()] }, { numero: 2, error: "x" }])
    assert.match(informe(f), /no ve las reglas de tu base de datos/);
  assert.doesNotMatch(informe({ numero: 1, hallazgos: [] }), /no ve las reglas/);
});

test("un crítico manda aunque falte otra familia", () => {
  const familias = [{ numero: 1, hallazgos: [h({ severity: "CRITICAL" })] }, { numero: 2, error: "x" }];
  assert.equal(recomendacion(familias), "❌ NO PUBLICAR");
});

test("tapa las claves en todos los campos", () => {
  const claves = [
    `sk-proj-${r}`,
    `sk_live_${r}`,
    `sb_secret_${r}`,
    `AIzaSy${r}`,
    "AKIA" + "ABCD1234EFGH5678",
    `ghp_${r}`,
    `SG.${r}.${r}`,
    `eyJhbGciOi${r}.${r}.${r}`,
  ];
  for (const c of claves) {
    const t = informe({ numero: 1, hallazgos: [h({ title: c, location: c, why: `antes ${c} después`, action: `"${c}"` })] });
    assert.ok(!t.includes(r) && !t.includes(c), c.slice(0, 6));
    assert.equal(t.split("clave oculta").length - 1, 4, c.slice(0, 6));
  }
  assert.ok(!ocultarClaves(`postgresql://u:${r}@host/db`).includes(r));
  assert.ok(!ocultarClaves(`JWT_SECRET=${r}`).includes(r));
  assert.ok(!ocultarClaves(`-----BEGIN PRIVATE KEY-----\n${r}`).includes(r));
});

test("no tapa texto normal", () => {
  const normales = [
    "src/lib/resumen-ia.ts:1",
    "20261125000000_demo_seguridad.sql",
    "Guárdala en Secrets y usa OPENAI_API_KEY desde el servidor",
    "https://example.com/a:b",
    "risk-based",
  ];
  for (const t of normales) assert.equal(ocultarClaves(t), t);
});

test("el texto del repositorio no mete formato en el informe", () => {
  const t = informe({ numero: 1, hallazgos: [h({ title: "x\n# Falso", why: "<img src=x> [a](http://x)" })] });
  assert.ok(!/^# Falso/m.test(t));
  assert.ok(!/(^|[^\\])<img/.test(t));
  assert.ok(!t.includes("[a](http"));
});

test("desde la terminal, con una familia que falta", () => {
  const d = mkdtempSync(join(tmpdir(), "informe-"));
  for (const n of [1, 2, 3]) writeFileSync(join(d, `familia-${n}.json`), agente(n, n === 2 ? [h({ severity: "HIGH" })] : []));
  const guion = join(dirname(fileURLToPath(import.meta.url)), "../scripts/informe.mjs");
  const out = execFileSync(process.execPath, [guion, "--entrada", d, "--salida", join(d, "i.md"), "--proyecto", "demo"], { encoding: "utf8" });
  assert.match(out, /REVISAR ANTES/);
  assert.match(out, /4 · Configuración: NO REVISADA/);
  assert.match(readFileSync(join(d, "i.md"), "utf8"), /falta 4 · Configuración/);
});
