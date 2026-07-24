# Handover: The Copy Vault — Social Automation

> **Cómo usar este documento:** pégalo al inicio de una conversación con Claude Code para
> dar contexto completo del sistema de automatización social. Describe **el estado real y
> funcionando** (no un plan). Está en producción.
>
> **STATUS: 🟢 LIVE** desde 2026-07-24. Publica solo, cada día, en Instagram y LinkedIn.

---

## 1. El proyecto

**The Copy Vault** es una base de datos de copies publicitarios icónicos con buscador. Web
estática (un único HTML) desplegada en Vercel.

| | |
|---|---|
| **Repo** | `adrian-gss/copy-vault` (GitHub, remoto por SSH) |
| **Directorio local** | `/Users/adrian.garcia@feverup.com/copy-vault` |
| **Archivo principal** | `index.html` (~170 KB, todo en uno: HTML+CSS+JS+corpus) |
| **Deploy web** | Vercel — dominio `copy-vault-gamma.vercel.app` (y dominio propio `the-copy-vault.com`, que es el que aparece en los posts) |
| **Comando de deploy** | `cd /Users/adrian.garcia@feverup.com/copy-vault && vercel --prod --yes` |

**El corpus:** ~565 entradas (array `const CORPUS = [...]` hardcodeado dentro de
`index.html`). Campos por copy: `copy`, `brand`, `sector`, `copy_type`, `year`, `campaign`,
`agency`, `medium`, `festival_or_note`, `lang` (`en`/`es`).

---

## 2. Qué hace la automatización

Una vez al día, de forma **totalmente automática**:
1. Elige un copy del corpus (rotación inteligente, ver §5).
2. Renderiza una imagen JPG 1080×1080 con el diseño del Copy Vault.
3. La publica en **Instagram** (vía Make) y en **LinkedIn** (vía API oficial), con el mismo
   caption.

**Instagram y LinkedIn son dos canales independientes** (ver §6 y §7). Se separaron porque
**LinkedIn prohibió Make en su plataforma**; Instagram sí sigue funcionando por Make.

---

## 3. Arquitectura real (pipeline)

Es un **híbrido Vercel Cron → GitHub Actions**. NO es un cron de GitHub (nunca disparaba
fiable) ni un script local. Flujo:

```
Vercel Cron  (vercel.json → "30 7 * * *", = 07:30 UTC)
   │  Vercel invoca una vez al día (GET) con Authorization: Bearer <CRON_SECRET>
   ▼
api/trigger-post.js   (endpoint serverless en Vercel)
   │  Llama a la GitHub API y hace "dispatch" del workflow
   ▼
GitHub Actions: .github/workflows/daily-post.yml   (evento: workflow_dispatch)
   ├─ checkout + Node 20 + npm install (en /automation) + playwright install chromium
   ├─ node generate.js   → elige copy, renderiza post.jpg, escribe caption.txt, avanza state.json
   ├─ git commit de automation/output/post.jpg + automation/state.json  ("[skip ci]")
   ├─ node post.js <sha>          → publica en INSTAGRAM (Make webhook)      [paso 1]
   └─ node post-linkedin.js       → publica en LINKEDIN (API)  · if: always() [paso 2]
```

> `if: always()` en el paso de LinkedIn = si Instagram falla, LinkedIn se publica igual (y
> viceversa: los pasos son independientes).

**Horario:** el cron de Vercel es **UTC fijo** (07:30). En hora de Madrid:
- Verano (CEST): **≈09:30**  ·  Invierno (CET): ≈08:30.
- La publicación real aparece ~2-4 min después (tarda el job de Actions).
- No se puede clavar una hora local todo el año (Vercel no ajusta el cambio de hora). Para
  cambiarla, edita el `schedule` en `vercel.json` (p.ej. `0 7 * * *` = 09:00 en verano).

---

## 4. Mapa de archivos

Todo lo de la automatización vive en `/automation` (+ el endpoint en `/api` y el workflow en
`/.github`).

| Archivo | Rol |
|---|---|
| `vercel.json` | Define el cron de Vercel (`crons` → `/api/trigger-post`). |
| `api/trigger-post.js` | Endpoint que Vercel invoca; hace dispatch del workflow vía GitHub API. Soporta `?dryRun=1` para probar el token sin publicar. Env: `GH_DISPATCH_TOKEN`, `CRON_SECRET`. |
| `api/linkedin-callback.js` | Callback OAuth de LinkedIn **temporal** alojado en Vercel (redirect `https://copy-vault-gamma.vercel.app/api/linkedin-callback`). Solo se usó para sacar tokens; se puede borrar. |
| `.github/workflows/daily-post.yml` | El workflow diario (los 5 pasos de §3). |
| `automation/generate.js` | Elige el copy, renderiza la imagen (Playwright), escribe `output/post.jpg` + `output/caption.txt`, actualiza `state.json`. **Es el cerebro.** |
| `automation/post.js` | Publica en **Instagram** enviando `{image_url, caption}` al `MAKE_WEBHOOK_URL`. El `image_url` es la raw de GitHub del `post.jpg` recién commiteado. |
| `automation/post-linkedin.js` | Publica en **LinkedIn** vía API (ver §7). Independiente de Make. |
| `automation/get-linkedin-token.js` | Flujo OAuth local **de un solo uso** para obtener el access/refresh token de LinkedIn. |
| `automation/state.json` | Estado de la rotación (ver §5). Se commitea cada día. |
| `automation/output/` | `post.jpg` (commiteado) + `caption.txt` (gitignored). |
| `index.html` | Contiene `window.renderPostImage(copy, brand, year)` — el mismo código Canvas 2D del botón "download post" de la web. `generate.js` lo reutiliza cargando el HTML en un navegador headless. |

---

## 5. Selección del copy, caption y estado

**Selección (`selectNext` en generate.js):** filtros duros + ranking suave con relajación
progresiva para no bloquearse:
- Duros: no repetir copy del ciclo; marca ≠ la del post anterior; idioma = español 1 de cada
  20 posts (resto inglés); si los 2 últimos no tenían año, este debe tener año.
- Suaves (desempate): marca no usada en los últimos 5 posts, sector distinto, alternar nivel
  de info (rico/ligero), y por último el más completo.
- Si se agota el ciclo, resetea `posted` y sigue.

**Caption (`buildCaption`):**
```
(N/365) "{copy}"

Brand: {brand} · {year}
Agency: {agency}
Campaign: {campaign}
Sector: {Sector}
Award: {festival_or_note}

Find this and more at: the-copy-vault.com

#advertising #copywriting #thecopyvault
```
(Las líneas Brand/Agency/… solo aparecen si el campo existe.)

**`state.json`:** `counter` (1..365), `posted` (índices ya usados este ciclo), `postIndex`
(total histórico), `lastBrand`, `lastSector`, `lastScore`, `lastTwoHadYear`, `recentBrands`.

---

## 6. Instagram (vía Make) — NO TOCAR

- `post.js` hace `POST` a `MAKE_WEBHOOK_URL` con `{ image_url, caption }`.
- `image_url` = `https://raw.githubusercontent.com/adrian-gss/copy-vault/<sha>/automation/output/post.jpg`
  (por eso el workflow commitea la imagen antes de publicar).
- Make recibe el webhook y publica en Instagram Business.
- ⚠️ **El escenario de Make debe publicar SOLO en Instagram.** Si aún tuviera un módulo de
  LinkedIn, LinkedIn se duplicaría (y además Make en LinkedIn está prohibido). Verificar en
  make.com.

---

## 7. LinkedIn (vía API oficial)

Publica en la **página de empresa** (organización), no en un perfil personal.

- **Script:** `automation/post-linkedin.js`. Lee `output/post.jpg` + `output/caption.txt`
  (los mismos que genera `generate.js`) y hace el flujo estándar de imagen de LinkedIn:
  1. `POST /rest/images?action=initializeUpload` (owner = org URN) → devuelve `uploadUrl` + `image` URN.
  2. `PUT` de los bytes del JPG a `uploadUrl`.
  3. Poll `GET /rest/images/{urn}` hasta `status: AVAILABLE` (best-effort).
  4. `POST /rest/posts` con `author` = org URN, `commentary` = caption, `content.media.id` = image URN.
- **Headers obligatorios:** `Authorization: Bearer …`, `LinkedIn-Version: <YYYYMM>`
  (default `202606`, override con env `LINKEDIN_VERSION`), `X-Restli-Protocol-Version: 2.0.0`.
- **App LinkedIn:** client_id `786ptou2qnkjc3`. Scopes: `w_organization_social r_organization_social`.
  Requiere que la app tenga aprobado el producto **Community Management API** (sin él, el
  OAuth falla con `unauthorized_scope_error`).
- **Página / org URN:** `urn:li:organization:129154196` (The Copy Vault). No es secreto.
- **Tokens:** `get-linkedin-token.js` devolvió access token (~60 días) **y** refresh token
  (~365 días). `post-linkedin.js` **auto-renueva**: si hay `LINKEDIN_REFRESH_TOKEN` +
  `LINKEDIN_CLIENT_SECRET`, pide un access token fresco en cada ejecución (así no caduca
  dentro del año). Si no, usa `LINKEDIN_ACCESS_TOKEN` tal cual.

**Truco para encontrar el org ID** (sin scope `rw_organization_admin`, que no tenemos):
descargar el HTML público de la página y buscarlo:
```bash
curl -sL -A "Mozilla/5.0" "https://www.linkedin.com/company/the-copy-vault/" \
  | grep -oE 'urn:li:(fsd_)?(organization|company):[0-9]+' | sort -u
```

---

## 8. Secrets y variables de entorno

**GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions). Todos SET a
2026-07-24. Valores NO en este doc.

| Secret | Para qué |
|---|---|
| `MAKE_WEBHOOK_URL` | Instagram (post.js). |
| `LINKEDIN_ORG_URN` | `urn:li:organization:129154196`. |
| `LINKEDIN_REFRESH_TOKEN` | Auto-renovación del token de LinkedIn. |
| `LINKEDIN_CLIENT_SECRET` | Necesario junto al refresh token. |
| `LINKEDIN_ACCESS_TOKEN` | Backup (se usa si no hay refresh). |

**Vercel env vars** (proyecto en Vercel):
| Var | Para qué |
|---|---|
| `GH_DISPATCH_TOKEN` | PAT de GitHub para disparar el workflow desde `trigger-post.js`. |
| `CRON_SECRET` | Vercel lo manda como Bearer; evita que cualquiera dispare el endpoint. |
| `LINKEDIN_CLIENT_SECRET` | Solo lo usaba el callback OAuth temporal. |

---

## 9. Entorno / tooling (gotchas de la máquina)

- **Node** está instalado vía **nvm** (v24.16.0). Originalmente **no existía `~/.zshrc`** y
  nvm no se cargaba → `node: command not found`. Ya se creó `~/.zshrc` que carga nvm; en
  terminales nuevas `node` funciona. Si vuelve a fallar: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`.
- **`gh` (GitHub CLI) NO está instalado.** Por eso los secrets se gestionan por la **web**.
- El push al repo va por **SSH** (funciona).

---

## 10. Operar y depurar

**Probar LinkedIn en local (solo LinkedIn, sin tocar Instagram):**
```bash
cd /Users/adrian.garcia@feverup.com/copy-vault/automation
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
node generate.js   # crea output/post.jpg + caption.txt (avanza state.json)
LINKEDIN_ORG_URN='urn:li:organization:129154196' LINKEDIN_ACCESS_TOKEN='<token>' node post-linkedin.js
```
> Si publicas un post de prueba y quieres que el cron del día siguiente **no repita** ese
> copy, commitea `state.json` avanzado. Si quieres NO gastar el copy, `git checkout automation/state.json`.

**Renovar el token manualmente** (no debería hacer falta en ~1 año gracias al refresh):
```bash
cd /Users/adrian.garcia@feverup.com/copy-vault/automation
LINKEDIN_CLIENT_SECRET=<secret> node get-linkedin-token.js   # requiere http://localhost:3000/callback en la app
```

**Disparar el workflow a mano:** GitHub → Actions → "Daily Post" → Run workflow. (Publica en
AMBOS canales.) O probar solo la conexión Vercel→GitHub: `GET /api/trigger-post?dryRun=1`.

**Errores comunes de LinkedIn:**
- `401` → token inválido/caducado (revisar refresh token + client secret).
- `403 ACCESS_DENIED` → falta scope o no eres admin de la página.
- `unauthorized_scope_error` (en el OAuth) → falta aprobar Community Management API en la app.

---

## 11. Correcciones respecto a versiones antiguas de este doc

- La arquitectura **ya no está "por decidir"**: es el híbrido Vercel Cron → GitHub Actions.
- La imagen **no** se genera con `node-canvas`, sino con **Playwright** cargando `index.html`
  y llamando a `window.renderPostImage` (misma lógica que el botón de la web). La función no
  se llama `downloadPost()`.
- LinkedIn publica en **página de empresa** (`w_organization_social`, `LINKEDIN_ORG_URN`), NO
  en perfil personal (no hay `LINKEDIN_PERSON_URN` ni `w_member_social`).
- Instagram sigue por **Make** (Make solo está prohibido en LinkedIn).
- Repo real: `adrian-gss/copy-vault`. Dominio de deploy: `copy-vault-gamma.vercel.app`.

---

## 12. Pendientes / cosas a vigilar

- [ ] Confirmar que el escenario de **Make publica solo en Instagram** (ver §6).
- [ ] (Opcional) Ajustar el `schedule` de `vercel.json` si se quiere otra hora.
- [ ] (Opcional) Borrar `api/linkedin-callback.js` (era temporal para el OAuth).
- [ ] El refresh token caduca en ~1 año (≈ julio 2027): re-ejecutar `get-linkedin-token.js`.
