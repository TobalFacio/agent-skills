# agent-skills — skills compartidas entre proyectos

Las skills `to-hu` y `to-tareas`, y el verificador de backlog, **sin nada de ningún
proyecto adentro**. Todo lo que cambia de un repo a otro vive en un solo archivo por
proyecto: `.agents/project.yml`.

Nacieron en **AI Core**, donde estaban escritas con las rutas, las épicas, las fases y el
repositorio de ese proyecto en el cuerpo del texto. Esa es la versión que sigue corriendo
allá. **Este repo no la toca.**

---

## Qué se sacó del texto y qué se quedó

| Se quedó en el SKILL.md (es cierto en cualquier proyecto) | Salió a `project.yml` (es cierto solo en uno) |
|---|---|
| Una historia = un archivo; exactamente una frase de actor | Cómo se escribe esa frase (`**Como**` / `**As a**`) |
| Todas las secciones del estándar son obligatorias | Cuáles son y en qué idioma |
| La sección de datos no puede quedar vacía, y un hueco se marca para poder greparlo | Cómo se llama la sección y cuál es la marca |
| No copiar la historia dentro del issue: enlazarla | El repo y la rama contra los que se arma el enlace |
| Usar las relaciones nativas del tracker, no prosa | La versión mínima de `gh`, los milestones, las etiquetas |
| Publicar en orden de dependencias | Las fases que definen ese orden |
| El verificador es el juez; no se entrega en rojo | Qué checks aplican en este proyecto |
| La rebanada vertical **no** baja al nivel de tarea | — |
| Expand–contract para refactors de radio amplio | — |

La prueba de que el corte quedó bien es `examples/ai-core.project.yml`: reproduce el
comportamiento actual de AI Core sin tocar una línea de los SKILL.md. Si algo de ese
proyecto no se pudiera expresar ahí, la generalización estaría incompleta.

---

## Estructura

```
agent-skills/
├── skills/
│   ├── to-hu/SKILL.md            conversación  → historia de usuario
│   ├── to-tareas/SKILL.md        historia      → plan de ejecución en issues
│   └── bitacora/SKILL.md         hecho del día → una entrada en la bitácora
├── scripts/
│   ├── verify-backlog.mjs        el juez, sin dependencias, leído desde project.yml
│   └── Link-AgentSkills.ps1      enlaza un repo con este, con seguro
├── templates/
│   └── project.yml               plantilla comentada, para copiar a <repo>/.agents/
└── examples/
    ├── ai-core.project.yml        equivalencia con lo que AI Core hace hoy
    └── plataforma-sig.project.yml arranque de Plataforma SIG
```

---

## Instalar en un proyecto

```powershell
git clone <url> C:\Dev\agent-skills

cd C:\Dev\agent-skills\scripts
.\Link-AgentSkills.ps1 -Project C:\Dev\SIG -Skills C:\Dev\agent-skills -WhatIf   # ensayo
.\Link-AgentSkills.ps1 -Project C:\Dev\SIG -Skills C:\Dev\agent-skills
```

Crea tres junctions y siembra la configuración:

```
C:\Dev\SIG\.claude\skills   ->  C:\Dev\agent-skills\skills
C:\Dev\SIG\.agents\skills   ->  C:\Dev\agent-skills\skills
C:\Dev\SIG\scripts\shared   ->  C:\Dev\agent-skills\scripts
C:\Dev\SIG\.agents\project.yml   (copia de templates/project.yml)
```

**El seguro:** si alguna de esas rutas ya existe como carpeta **real**, el script se
detiene y no toca nada. Correrlo por accidente sobre un repo que tiene sus propias
skills no las borra — te obliga a moverlas tú, a conciencia.

Los junctions **no se versionan** (el script los agrega a `.gitignore`). Lo que sí se
versiona es `.agents/project.yml`: es parte del proyecto.

Después: ajusta `.agents/project.yml` y corre

```
node scripts\shared\verify-backlog.mjs
```

---

## El contrato: `.agents/project.yml`

Un solo archivo declarativo. Las skills **leen de ahí y de ningún otro lado**: si un
valor no está, no lo adivinan — se detienen y lo piden. Adivinar la ruta del backlog a
partir del nombre de una carpeta escribe la historia en el lugar equivocado y el error
aparece tres días después.

Un campo en `null` significa *"este proyecto no tiene eso"* y **desactiva el paso**, no lo
rompe. Un proyecto nuevo empieza sin glosario, sin ERD, sin grafo mermaid y sin totales,
y las skills funcionan igual; esas piezas se encienden cuando estorbe no tenerlas.

Secciones:

| Sección | Qué declara |
|---|---|
| `project` | nombre, repo, rama por defecto, idioma de docs y de interfaz |
| `paths` | backlog, índice, contexto, plantilla, glosario, ERD, mockups, diagramas, bitácora |
| `story` | prefijo de id, marcadores de actor, secciones del estándar, marcas de hueco e inferencia, claves del frontmatter |
| `enums` | los conjuntos cerrados: status, phase, stage, priority, module, milestone, épica |
| `index` | forma de la fila del índice, y si hay grafo mermaid, totales y subtotal |
| `tracker` | milestones, etiquetas, versión mínima del CLI, patrón de rama, política de PR |
| `board` | espejo externo (Notion), o `enabled: false` |
| `verify` | el comando juez y qué checks se encienden |

---

## La bitácora

`skills/bitacora/SKILL.md` — hace **una cosa**: agregar una entrada al archivo del día en
`paths.bitacora`. Si esa clave es `null`, se salta el paso.

Corre **inmediatamente después del auditor, siempre**, cumpla o no cumpla el dictamen. Que sea una
skill aparte y no parte del auditor es deliberado: separar los dos roles es lo que permite que la
bitácora **nunca bloquee** el ciclo. Si el auditor falla, no hay nada que registrar; si la bitácora
falla, el dictamen sigue siendo válido y el merge sigue.

Cuatro invariantes: **nunca reescribe** contenido previo —una entrada equivocada se corrige con una
entrada nueva que cita la hora de la errónea—; **nunca falla el ciclo**; **nunca inventa** un dato
que no le llegó (escribe `—`, no lo deduce de git); y **una llamada = una entrada**.

Lo único que no sale de `project.yml` es la **fecha y hora local**: la pide o la lee del entorno, y
nunca la adivina. Una bitácora con la hora mal es peor que no tenerla, porque reordena el día en
silencio.

---

## Los `.ps1` van en UTF-8 **con BOM**

No es una preferencia de estilo. **Windows PowerShell 5.1 lee un `.ps1` sin BOM como ANSI (cp1252).**
Ahí los bytes `0x91`–`0x94` —que aparecen dentro de `—`, `─`, `→` y de los emoji— se convierten en
comillas tipográficas, y **PowerShell las acepta como delimitadores de cadena**. Un guion largo
dentro de un texto entre comillas dobles cierra la cadena a media línea y el script revienta varias
líneas después, en un punto que no tiene ninguna relación con el error.

`Link-AgentSkills.ps1` cayó justo en eso (su línea 134). Está corregido: guion largo a `-` y archivo
con BOM. Verificado con el parser de PowerShell en dos escenarios —el archivo tal cual y forzándolo a
decodificar como ANSI—: parsea en los dos, así que aguanta aunque alguien le quite el BOM al editarlo.

Como es el primer script que corre cualquier proyecto nuevo, conviene un guard en CI:

```bash
fallo=0
while IFS= read -r -d '' f; do
  head -c 3 "$f" | grep -q $'\xef\xbb\xbf' || { echo "::error file=$f::Falta el BOM UTF-8"; fallo=1; }
  LC_ALL=C grep -qP '[\x91-\x94]' "$f" && { echo "::error file=$f::Bytes 0x91-0x94 (— ─ → o emoji)"; fallo=1; }
done < <(find . -name '*.ps1' -print0)
exit $fallo
```

Los `.mjs` no corren riesgo: Node siempre lee UTF-8.

---

## El verificador

`scripts/verify-backlog.mjs` — Node, **cero dependencias**, corre desde cualquier punto
dentro del repo (busca `.agents/project.yml` hacia arriba).

```
node scripts/shared/verify-backlog.mjs
node scripts/shared/verify-backlog.mjs --quiet
node scripts/shared/verify-backlog.mjs --config ruta/a/project.yml
```

Sale 0 si todo pasa, 1 si no. Comprueba, según lo que encienda `verify.checks`:

| Check | Qué atrapa |
|---|---|
| `ids` | ids duplicados, y el número del archivo contra el id de adentro |
| `references` | `depends_on` / `blocks` que apuntan a historias que no existen |
| `symmetry` | el par que solo está declarado de un lado |
| `phase_order` | una historia que depende de otra de fase posterior |
| `frontmatter` | claves requeridas ausentes, claves prohibidas presentes, estimado no numérico |
| `enums` | un valor fuera del conjunto declarado |
| `sections` | falta una sección del estándar |
| `single_actor` | cero o dos frases de actor |
| `data_section` | la sección de datos vacía, o un hueco mal escrito |
| `index_rows` | el índice y el frontmatter en desacuerdo |
| `index_totals` | los totales que no cuadran |
| `mermaid` | nodos sin declarar, sin clase, o **aristas que no son `depends_on`** |
| `diagrams` | un diagrama que cita una historia muerta o le anota otra fase |

Los 18 casos de error están probados: cada uno rompe una cosa en un repo de prueba y el
verificador la detecta. Un caso que saliera verde sería un check que no existe.

**Por qué la sección de datos es obligatoria aunque la respuesta sea "nada".** La
auditoría que originó este script encontró 60 de 70 historias sin esa sección. Ese hueco
es lo que permitía que un criterio prometiera columnas que nadie había modelado: la
historia pasaba revisión, llegaba al desarrollador, y solo entonces resultaba que
necesitaba una tabla inexistente. Un encabezado seguido de silencio es indistinguible de
un encabezado que nadie llenó — por eso hay que escribir la respuesta, y por eso un hueco
se marca con una forma fija que se puede grepear en todo el backlog.

---

## Migrar AI Core, el día que quieras

No hay prisa y no hay que hacerlo ahora. Cuando toque:

1. Copia `examples/ai-core.project.yml` a `AICore/.agents/project.yml`.
2. Corre el verificador nuevo **apuntando al backlog real** y compara su salida con la del
   script viejo. Deben coincidir historia por historia.
3. Solo entonces cambia los junctions con `Link-AgentSkills.ps1` (te va a obligar a mover
   `.agents\skills` a mano — es el seguro haciendo su trabajo).
4. Borra las skills locales y `scripts/verify-backlog.mjs` en un commit aparte, para poder
   revertirlo solo.

Mientras tanto AI Core sigue exactamente como está.

---

## Deudas abiertas

- **Los agentes** (`backend-dotnet`, `frontend-angular`, `db-schema`, `hu-auditor`,
  `backlog-keeper`) siguen atados a su proyecto. Este repo generalizó las skills.
  `hu-auditor` y `backlog-keeper` son los siguientes candidatos naturales: ya leen las
  mismas rutas que ahora están en `project.yml`.
- **Un solo tracker.** `tracker.kind` solo acepta `github`. La estructura deja lugar para
  otro, pero nadie lo ha escrito.
- **La plantilla de historia no está aquí.** Cada proyecto la tiene en `paths.template`,
  porque el orden de las secciones ya está en `story.sections` y duplicarla invitaría a
  que se desincronicen.
