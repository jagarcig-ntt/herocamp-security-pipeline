# Pipeline de seguridad · Hero Camp

Cuatro agentes de IA que leen el código de un proyecto, buscan fallos de seguridad y escriben un informe para alguien que no programa.

- Un **agente** es un programa de IA que recibe una tarea y decide por su cuenta qué pasos dar para hacerla.
- Un **pipeline** es una secuencia de pasos que se lanzan juntos.

Se creó para la sesión de seguridad de AI PM Pro (The Hero Camp), del 10 de diciembre de 2026.

> **Si tu producto es de Lovable, no lo necesitas.** Con el escáner de Lovable, los tres prompts y la checklist de la guía de la sesión tienes lo necesario.

## Antes de usarlo

- **Necesitas una cuenta de Claude con acceso a Claude Code.** Cada revisión cuenta en el límite de uso de tu cuenta.
- **Los agentes envían a Anthropic los ficheros que leen.** No lo uses con un proyecto si no tienes permiso para hacerlo.
- **No sustituye a una auditoría profesional.** Puede equivocarse o no ver un fallo.

## Qué revisa cada agente

| Agente | Qué busca |
|---|---|
| 1 · Claves y secretos | Claves secretas escritas en el código o que llegan al navegador |
| 2 · Datos y permisos | Reglas que dejan leer o cambiar datos de otras personas |
| 3 · Datos personales | Datos personales en la consola o en los registros, enviados a otros servicios o pedidos sin necesidad |
| 4 · Configuración | Páginas de administración sin inicio de sesión, rutas de prueba y ajustes abiertos |

## Instalación

Se usa desde una **terminal**, la ventana donde se escriben órdenes para el ordenador. En Windows, usa **Git Bash**, que se instala con git.

1. **git:** https://git-scm.com
2. **Node.js:** https://nodejs.org
3. **Claude Code para la terminal:** https://code.claude.com/docs. En Windows también sirve `winget install Anthropic.ClaudeCode`.
4. **Cierra la terminal, ábrela de nuevo e inicia sesión en Claude:** escribe `claude`, sigue los pasos y sal con `/exit`.
5. **Copia este repositorio:**

```bash
git clone https://github.com/jagarcig-ntt/herocamp-security-pipeline
cd herocamp-security-pipeline
```

## Uso

```bash
# Un repositorio público de GitHub
bash auditar.sh https://github.com/usuario/proyecto

# Una rama concreta
bash auditar.sh https://github.com/usuario/proyecto --rama nombre-de-la-rama

# Una carpeta de tu ordenador
bash auditar.sh ../mi-proyecto

# Un solo agente (1, 2, 3 o 4)
bash auditar.sh ../mi-proyecto --familia 2
```

El informe se guarda como `security-report.md` en la carpeta desde la que lo lanzas. **Si ya había uno, lo sustituye.** Con `--familia 2`, se llama `security-report-f2.md`.

**Pruébalo** con el proyecto de la sesión, que tiene un fallo a propósito por cada familia, con claves y datos inventados:

```bash
bash auditar.sh https://github.com/jagarcig-ntt/feedback-hub --rama demo/seguridad
```

El informe que debería salir se parece a [este ejemplo](ejemplos/security-report.md). La redacción cambia de una vez a otra.

**Cuánto tarda:** entre 36 y 72 segundos en ese proyecto, en seis ejecuciones del 25 de noviembre de 2026. Un proyecto más grande tarda más.

## Cómo leer el informe

| Resultado | Qué significa |
|---|---|
| ❌ NO PUBLICAR | Hay al menos un hallazgo crítico |
| ⚠️ REVISAR ANTES DE PUBLICAR | No hay críticos, pero sí altos |
| ⚠️ REVISIÓN INCOMPLETA | Algún agente no ha terminado. Vuelve a lanzarlo |
| ✅ SIN HALLAZGOS GRAVES | No ha encontrado críticos ni altos en el código. No significa que el proyecto sea seguro |

**Si sale una clave secreta:** cámbiala en el servicio antes de nada. Crea una nueva, borra la antigua y no la pegues en ningún otro sitio.

## Qué no revisa

- **La base de datos real.** Solo lee el código. En Lovable, mira **More → Security → Findings**.
- **El historial de git.** Una clave borrada en una versión anterior no sale.
- **La web publicada.**
- **Los ficheros que git ignora,** si revisas una carpeta que usa git. Si la carpeta no usa git, se revisa entera, con su `.env` (el fichero donde se guardan las claves) si lo tiene.

## Cómo protege el proyecto que revisa

- **Trabaja sobre una copia temporal** y la borra al terminar. El proyecto original no cambia.
- **Los agentes solo pueden leer y buscar.** No ejecutan órdenes, no escriben ficheros y no pueden visitar páginas web.
- **No cargan la configuración de Claude Code del proyecto revisado.**
- **El informe oculta las claves** por su formato, y los agentes tienen orden de no copiarlas. Aun así, revísalo antes de compartirlo.
- **Un proyecto podría llevar texto escrito para engañar a los agentes.** Tienen orden de no hacer caso, pero eso depende del modelo de IA y no es una garantía.

## Si algo falla

| Problema | Qué hacer |
|---|---|
| `falta Claude Code` o `falta Node.js` | Instálalo, cierra la terminal y ábrela de nuevo |
| Los cuatro agentes fallan | Escribe `claude` y comprueba que has iniciado sesión y que no has llegado al límite de uso |
| Un agente se detiene por tiempo | Dale más segundos: `LIMITE=300 bash auditar.sh …` |
| No puede copiar el repositorio | Comprueba la dirección, la rama y que sea público |

**Probado en Windows con Git Bash.** Está escrito para funcionar también en macOS y Linux, pero ahí no se ha probado.

## Cómo está hecho

| Fichero | Qué hace |
|---|---|
| `auditar.sh` | Copia el proyecto, lanza los agentes a la vez y pide el informe |
| `agentes/` | Las instrucciones de cada agente, en español |
| `scripts/informe.mjs` | Une las respuestas y escribe el informe. No usa IA |
| `pruebas/` | Pruebas del informe: `node --test pruebas/*.test.mjs`. No gastan uso de Claude |

## Licencia

[MIT](LICENSE): puedes usarlo, copiarlo y modificarlo.
