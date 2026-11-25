// Une las respuestas de los agentes y escribe el informe. No usa IA ni dependencias.
//   node informe.mjs --entrada <carpeta> --salida <informe.md> --proyecto <nombre> [--familias 1,2,3,4]
// En la carpeta de entrada espera familia-1.json … familia-4.json (la salida de `claude -p --output-format json`).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const FAMILIAS = {
  1: "Claves y secretos",
  2: "Datos y permisos",
  3: "Datos personales",
  4: "Configuración",
};
const GRAVEDAD = { CRITICAL: "🔴 Crítico", HIGH: "🟠 Alto", MEDIUM: "🟡 Medio" };
const NOMBRE = { CRITICAL: "críticos", HIGH: "altos", MEDIUM: "medios" };
const ORDEN = Object.keys(GRAVEDAD);
const CAMPOS = ["title", "location", "why", "action"];
const OCULTA = "[clave oculta]";

const CLAVES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\beyJ[\w-]{8,}(?:\.[\w-]+){0,2}/g,
  /\b(?:sk|pk|rk|whsec)[-_][\w-]{8,}/g,
  /\bsb_(?:secret|publishable)_[\w-]{6,}/g,
  /\bAIza[\w-]{10,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{10,}/g,
  /\b(?:gh[pousr]_|github_pat_|glpat-|xox[abprs]-|npm_)[\w-]{8,}/g,
  /\bSG\.[\w-]{6,}(?:\.[\w-]+)?/g,
];

export function ocultarClaves(texto) {
  let t = String(texto);
  for (const patron of CLAVES) t = t.replace(patron, OCULTA);
  // Contraseña dentro de una dirección: postgresql://usuario:contraseña@servidor
  t = t.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s@]+@/gi, `$1${OCULTA}@`);
  // NOMBRE_SECRET = "valor"
  t = t.replace(
    /(\b\w*(?:secret|token|password|passwd|contraseña|api_?key|service_role_key)\w*["']?\s*[:=]\s*)(["'`]?)[^\s"'`,;)]{6,}\2/gi,
    (todo, nombre) => (todo.includes(OCULTA) ? todo : `${nombre}${OCULTA}`),
  );
  return t;
}

// El texto viene de un repositorio ajeno: se escribe en una línea y sin formato activo.
const limpio = (t) =>
  ocultarClaves(t)
    .replace(/[\r\n]+/g, " ")
    .replace(/[<>[\]|]/g, "\\$&")
    .trim();
const codigo = (t) => "`" + ocultarClaves(t).replace(/[`\r\n]+/g, " ").trim() + "`";

// Devuelve { hallazgos } o { error }. Ante la duda, error: una familia mal leída no se da por revisada.
export function leerFamilia(contenido, numero) {
  let salida;
  try {
    salida = JSON.parse(contenido);
  } catch {
    return { error: "el agente no ha respondido o su respuesta está incompleta" };
  }
  if (salida?.is_error) return { error: "el agente ha terminado con un error" };
  let datos = salida;
  if (typeof salida?.result === "string") {
    const inicio = salida.result.indexOf("{");
    const fin = salida.result.lastIndexOf("}");
    try {
      datos = JSON.parse(salida.result.slice(inicio, fin + 1));
    } catch {
      return { error: "la respuesta del agente no tiene el formato esperado" };
    }
  }
  if (!Array.isArray(datos?.findings)) return { error: "la respuesta del agente no tiene lista de hallazgos" };
  if (Number(datos.family) !== numero) return { error: "el agente ha respondido sobre otra familia" };
  const valido = (h) => h && GRAVEDAD[h.severity] && CAMPOS.every((c) => typeof h[c] === "string" && h[c].trim());
  if (!datos.findings.every(valido)) return { error: "algún hallazgo está incompleto" };
  return { hallazgos: [...datos.findings].sort((a, b) => ORDEN.indexOf(a.severity) - ORDEN.indexOf(b.severity)) };
}

export function recomendacion(familias) {
  const todos = familias.flatMap((f) => f.hallazgos ?? []);
  if (todos.some((h) => h.severity === "CRITICAL")) return "❌ NO PUBLICAR";
  if (todos.some((h) => h.severity === "HIGH")) return "⚠️ REVISAR ANTES DE PUBLICAR";
  if (familias.some((f) => f.error)) return "⚠️ REVISIÓN INCOMPLETA";
  return "✅ SIN HALLAZGOS GRAVES";
}

// Sin hallazgos en F2 no significa que los permisos estén bien: el informe siempre lo dice.
const AVISO_F2 =
  "**Este informe no ve las reglas de tu base de datos,** solo el código. En Lovable, compruébalas en **More → Security → Findings**.";
const cuenta = (f, g) => f.hallazgos.filter((h) => h.severity === g).length;

export function escribirInforme({ proyecto, fecha, familias }) {
  const pendientes = familias.filter((f) => f.error);
  const l = [
    `# Informe de seguridad · ${limpio(proyecto)}`,
    "",
    `*${fecha} · ${familias.length === 4 ? "Las cuatro familias" : "Revisión parcial"}*`,
    "",
    `## ${recomendacion(familias)}`,
    "",
  ];
  if (pendientes.length)
    l.push(`**Revisión incompleta:** falta ${pendientes.map((f) => `${f.numero} · ${FAMILIAS[f.numero]}`).join("; ")}. Vuelve a lanzarla.`, "");
  l.push("| Familia | Crítico | Alto | Medio |", "|---|---|---|---|");
  for (const f of familias)
    l.push(`| ${f.numero} · ${FAMILIAS[f.numero]} | ${f.error ? "No revisada | No revisada | No revisada" : ORDEN.map((g) => cuenta(f, g)).join(" | ")} |`);
  l.push(
    "",
    "- **Crítico:** otra persona puede aprovecharlo con lo que hay en el código. Arréglalo antes de publicar.",
    "- **Alto:** riesgo real que necesita alguna condición más. Revísalo antes de publicar.",
    "- **Medio:** mejora recomendada.",
    "",
  );
  for (const f of familias) {
    l.push(`## ${f.numero} · ${FAMILIAS[f.numero]}`, "");
    if (f.numero === 2) l.push(AVISO_F2, "");
    if (f.error) l.push(`**No revisada:** ${f.error}. Esto no significa que esté bien.`, "");
    else if (!f.hallazgos.length) l.push("Sin hallazgos en el código revisado.", "");
    else
      for (const h of f.hallazgos)
        l.push(
          `### ${GRAVEDAD[h.severity]} · ${limpio(h.title)}`,
          "",
          `- **Dónde:** ${codigo(h.location)}`,
          `- **Por qué importa:** ${limpio(h.why)}`,
          `- **Qué hacer:** ${limpio(h.action)}`,
          "",
        );
  }
  l.push(
    "## Qué no revisa este informe",
    "",
    "- La base de datos real: solo el código.",
    "- Las versiones anteriores del código (el historial de git).",
    "- La web publicada.",
    "- Los hallazgos los encuentra una IA a partir del código: puede equivocarse o no ver un fallo. No sustituye a una auditoría profesional.",
    "",
  );
  return l.join("\n");
}

function principal() {
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const [entrada, salida, proyecto] = ["entrada", "salida", "proyecto"].map(arg);
  const numeros = (arg("familias") ?? "1,2,3,4").split(",").map(Number);
  if (!entrada || !salida || !proyecto || !numeros.every((n) => FAMILIAS[n])) {
    console.error("Uso: node informe.mjs --entrada <carpeta> --salida <informe.md> --proyecto <nombre> [--familias 1,2,3,4]");
    process.exit(2);
  }
  const familias = numeros.map((numero) => {
    let contenido = "";
    try {
      contenido = readFileSync(join(entrada, `familia-${numero}.json`), "utf8");
    } catch {
      // Sin fichero: leerFamilia lo da por no revisado.
    }
    return { numero, ...leerFamilia(contenido, numero) };
  });
  writeFileSync(salida, escribirInforme({ proyecto, fecha: new Date().toLocaleDateString("es-ES"), familias }));
  console.log(recomendacion(familias));
  for (const f of familias) {
    const detalle = f.error ? `NO REVISADA (${f.error})` : ORDEN.map((g) => `${NOMBRE[g]} ${cuenta(f, g)}`).join(", ");
    console.log(`  ${f.numero} · ${FAMILIAS[f.numero]}: ${detalle}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal();
