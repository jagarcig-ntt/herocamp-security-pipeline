#!/usr/bin/env bash
# Revisa la seguridad de un repositorio con cuatro agentes de Claude Code, uno por familia.
# Funciona en Git Bash (Windows), macOS y Linux. Instrucciones: README.md
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIMITE="${LIMITE:-150}"     # segundos por agente
MODELO="${MODELO:-sonnet}"
NOMBRES=("" "Claves y secretos" "Datos y permisos" "Datos personales" "Configuración")
FICHEROS=("" "familia-1-claves.md" "familia-2-datos.md" "familia-3-datos-personales.md" "familia-4-configuracion.md")

uso() {
  echo "Uso: ./auditar.sh <carpeta o URL de GitHub> [--rama <rama>] [--familia <1-4>]"
  echo "Ejemplos:"
  echo "  ./auditar.sh https://github.com/usuario/proyecto"
  echo "  ./auditar.sh ../mi-proyecto --familia 2"
}
error() { echo "Error: $*" >&2; exit 1; }

# --- Lo que pide la persona ---
ORIGEN="" RAMA="" FAMILIA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rama|--familia)
      [ $# -ge 2 ] || { uso; error "falta el valor de $1"; }
      if [ "$1" = "--rama" ]; then RAMA="$2"; else FAMILIA="$2"; fi
      shift 2 ;;
    -h|--help) uso; exit 0 ;;
    -*) uso; error "no conozco la opción $1" ;;
    *) [ -z "$ORIGEN" ] || { uso; error "solo se puede revisar un repositorio cada vez"; }
       ORIGEN="$1"; shift ;;
  esac
done
[ -n "$ORIGEN" ] || { uso; exit 1; }
case "$FAMILIA" in ""|[1-4]) ;; *) error "--familia tiene que ser 1, 2, 3 o 4" ;; esac
case "$RAMA" in -*) error "el nombre de la rama no es válido" ;; esac

# --- Lo que hace falta ---
command -v git    >/dev/null 2>&1 || error "falta git. Instálalo desde https://git-scm.com"
command -v node   >/dev/null 2>&1 || error "falta Node.js. Instálalo desde https://nodejs.org"
command -v claude >/dev/null 2>&1 || error "falta Claude Code para la terminal. Instrucciones: https://code.claude.com/docs"

LISTA="${FAMILIA:-1 2 3 4}"
for n in $LISTA; do
  [ -f "$AQUI/agentes/${FICHEROS[$n]}" ] || error "no encuentro agentes/${FICHEROS[$n]}"
done

# --- Copia temporal: el repositorio original no se toca ---
TRABAJO="$(mktemp -d)" || error "no puedo crear una carpeta temporal"
PIDS=""
limpiar() {
  for p in $PIDS; do kill "$p" 2>/dev/null; done
  cd "$AQUI" && rm -rf "$TRABAJO"
}
trap limpiar EXIT
trap 'echo; echo "Cancelado."; exit 130' INT TERM
COPIA="$TRABAJO/copia"
RESPUESTAS="$TRABAJO/respuestas"
mkdir "$COPIA" "$RESPUESTAS"

case "$ORIGEN" in
  http://github.com/*) ORIGEN="https://${ORIGEN#http://}" ;;
esac
case "$ORIGEN" in
  https://*)
    PROYECTO="$(basename "${ORIGEN%/}" .git)"
    echo "Copiando $PROYECTO${RAMA:+ (rama $RAMA)}…"
    OPCIONES=(--quiet --depth 1 --single-branch --no-tags)
    [ -z "$RAMA" ] || OPCIONES+=(--branch "$RAMA")
    GIT_TERMINAL_PROMPT=0 GIT_LFS_SKIP_SMUDGE=1 git -c core.symlinks=false clone "${OPCIONES[@]}" -- "$ORIGEN" "$COPIA" ||
      error "no he podido copiar $ORIGEN. Comprueba la dirección, la rama y que el repositorio sea público"
    [ -z "$RAMA" ] || PROYECTO="$PROYECTO ($RAMA)"
    ;;
  *://*|*::*|git@*) error "solo se admiten carpetas y direcciones https://" ;;
  *)
    [ -z "$RAMA" ] || error "--rama solo sirve con una dirección https://. En una carpeta se revisa lo que tiene ahora"
    [ -d "$ORIGEN" ] || error "no existe la carpeta $ORIGEN"
    ORIGEN="$(cd "$ORIGEN" && pwd)"
    PROYECTO="$(basename "$ORIGEN")"
    echo "Copiando ${PROYECTO}…"
    if git -C "$ORIGEN" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      # Solo lo que está o puede acabar en git: un .env ignorado no se copia ni se envía.
      (cd "$ORIGEN" && git ls-files -z -co --exclude-standard |
        while IFS= read -r -d '' f; do
          if [ -f "$f" ] && [ ! -L "$f" ]; then printf './%s\0' "$f"; fi
        done | tar cf - --null -T -) | tar xf - -C "$COPIA" ||
        error "no he podido copiar la carpeta"
    else
      (cd "$ORIGEN" && tar cf - --exclude=node_modules --exclude=.git .) | tar xf - -C "$COPIA" ||
        error "no he podido copiar la carpeta"
    fi
    ;;
esac
rm -rf "$COPIA/.git"
find "$COPIA" -type l -exec rm -f {} + 2>/dev/null   # los enlaces podrían apuntar fuera de la copia
[ -n "$(ls -A "$COPIA")" ] || error "no hay ficheros que revisar"

# --- Los agentes ---
# Solo pueden leer y buscar dentro de la copia. No cargan la configuración del repositorio revisado.
# Claude Code valida la respuesta con este esquema antes de devolverla.
ESQUEMA='{"type":"object","properties":{"family":{"type":"integer"},"findings":{"type":"array","items":{"type":"object","properties":{"severity":{"type":"string","enum":["CRITICAL","HIGH","MEDIUM"]},"title":{"type":"string"},"location":{"type":"string"},"why":{"type":"string"},"action":{"type":"string"}},"required":["severity","title","location","why","action"]}}},"required":["family","findings"]}'

agente() {
  local n="$1" intento inicio pid motivo respuesta="$RESPUESTAS/familia-$1.json"
  inicio=$(date +%s)
  echo "  ▶ $n · ${NOMBRES[$n]}"
  for intento in 1 2; do
    (cd "$COPIA" && exec claude -p "Revisa el repositorio de la carpeta actual. Devuelve solo el JSON." \
      --system-prompt-file "$AQUI/agentes/${FICHEROS[$n]}" \
      --safe-mode --restricted --strict-mcp-config --no-session-persistence \
      --tools "Read,Glob,Grep" --allowedTools "Read,Glob,Grep" \
      --model "$MODELO" --output-format json --json-schema "$ESQUEMA") \
      </dev/null >"$respuesta" 2>"$RESPUESTAS/error-$n.txt" &
    pid=$!
    trap 'kill "$pid" 2>/dev/null; exit 1' TERM
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$(( $(date +%s) - inicio ))" -ge "$LIMITE" ]; then
        kill "$pid" 2>/dev/null; sleep 1; kill -9 "$pid" 2>/dev/null
        wait "$pid" 2>/dev/null
        : >"$respuesta"
        echo "  ✖ $n · ${NOMBRES[$n]}: más de $LIMITE s, se detiene"
        return
      fi
      sleep 1
    done
    if wait "$pid"; then
      if motivo=$(node "$AQUI/scripts/informe.mjs" --validar "$respuesta" --familias "$n"); then
        echo "  ✔ $n · ${NOMBRES[$n]}: $(( $(date +%s) - inicio )) s"
        return
      fi
    else
      : >"$respuesta"
      motivo="Claude Code ha terminado con un error"
    fi
    [ "$intento" = 2 ] || echo "  ↻ $n · ${NOMBRES[$n]}: $motivo. Segundo intento"
  done
  echo "  ✖ $n · ${NOMBRES[$n]}: $motivo"
  head -n 3 "$RESPUESTAS/error-$n.txt" | sed 's/^/      /'
}

COMIENZO=$(date +%s)
echo "Revisando $PROYECTO con Claude Code ($MODELO):"
for n in $LISTA; do agente "$n" & PIDS="$PIDS $!"; done
wait
PIDS=""

# --- El informe ---
INFORME="$PWD/security-report${FAMILIA:+-f$FAMILIA}.md"
echo
node "$AQUI/scripts/informe.mjs" --entrada "$RESPUESTAS" --salida "$INFORME" --proyecto "$PROYECTO" \
  --familias "$(echo "$LISTA" | tr ' ' ',')" || error "no he podido escribir el informe"
echo
echo "Informe: $INFORME"
echo "Duración: $(( $(date +%s) - COMIENZO )) s"
