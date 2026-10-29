const VERSION = "8.1.0";
const CRON_EVERY_MINUTE = "* * * * *";

const DEFAULTS = {
  siteUrl: "https://noticierovoid.com",
  rssUrl: "https://noticierovoid.com/rss.xml",
  model: "@cf/zai-org/glm-4.7-flash",
  batchSize: 4,
  linksPerBatch: 1,
  maxPostsPerDay: 32,
  maxLinkedPerDay: 8,
  maxArticleAgeHours: 72,
  maxPostChars: 280,
  monthlyBudgetEur: 10,
  hardStopEur: 8,
  usdToEurRate: 1.05,
  normalPostUsd: 0.015,
  urlPostUsd: 0.20,
  tweetSpacingSeconds: 15,
  autoPublish: false,
  autoBatchEnabled: false,
  autoBatchIntervalHours: 3,
  timezone: "Europe/Madrid"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

      if (url.pathname === "/api/health") {
        return json({ ok: true, version: VERSION, cron: CRON_EVERY_MINUTE, timestamp: new Date().toISOString() });
      }

      if (url.pathname === "/" && request.method === "GET") {
        return new Response(dashboard(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
        });
      }

      if (!env.DB) throw new Error("Configura el binding D1 DB.");
      if (!authorized(request, env)) return json({ ok: false, error: "Token ADMIN_TOKEN no válido." }, 401);
      await schema(env);

      if (url.pathname === "/api/status") return json(await getStatus(env));
      if (url.pathname === "/api/settings" && request.method === "GET") {
        return json({ ok: true, settings: await getSettings(env) });
      }

      if (url.pathname === "/api/settings" && request.method === "POST") {
        const body = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw new Error("Cuerpo de configuración no válido.");
        }

        const next = { ...(await getSettings(env)) };

        for (const [key, value] of Object.entries(body)) {
          if (!Object.hasOwn(DEFAULTS, key)) continue;
          const def = DEFAULTS[key];

          if (typeof def === "boolean") {
            if (typeof value !== "boolean") throw new Error(`${key} debe ser verdadero o falso.`);
            next[key] = value;
          } else if (typeof def === "number") {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0) throw new Error(`Valor no válido para ${key}.`);
            next[key] = n;
          } else if (typeof def === "string") {
            if (typeof value !== "string" || !value.trim()) throw new Error(`Valor no válido para ${key}.`);
            next[key] = value.trim();
          }
        }

        if (next.batchSize < 1 || next.batchSize > 4) throw new Error("La tanda debe contener entre 1 y 4 tweets.");
        if (next.linksPerBatch > next.batchSize) throw new Error("Los enlaces no pueden superar la cantidad de tweets.");
        if (next.maxPostChars < 50 || next.maxPostChars > 280) throw new Error("La longitud debe estar entre 50 y 280.");
        if (next.maxPostsPerDay < 1 || next.maxPostsPerDay > 100) throw new Error("El límite diario debe estar entre 1 y 100.");
        if (next.maxLinkedPerDay < 0 || next.maxLinkedPerDay > next.maxPostsPerDay) throw new Error("El límite diario de enlaces no es válido.");
        if (next.maxArticleAgeHours < 1 || next.maxArticleAgeHours > 720) throw new Error("La antigüedad máxima debe estar entre 1 y 720 horas.");
        if (next.autoBatchIntervalHours < 1 || next.autoBatchIntervalHours > 24) throw new Error("El intervalo automático debe estar entre 1 y 24 horas.");
        if (next.tweetSpacingSeconds > 120) throw new Error("La separación entre tweets no puede superar 120 segundos.");
        if (next.usdToEurRate <= 0) throw new Error("La conversión USD/EUR debe ser mayor que cero.");

        new Intl.DateTimeFormat("es", { timeZone: next.timezone });
        next.rssUrl = normalizeRssUrl(next.rssUrl);
        next.siteUrl = normalizeHttpUrl(next.siteUrl, "URL de la web");

        for (const [key, value] of Object.entries(next)) await setSetting(env, key, value);

        await logEvent(env, "info", "Configuración actualizada.");
        return json({ ok: true, settings: await getSettings(env) });
      }

      if (url.pathname === "/api/articles") {
        return json({ ok: true, articles: await fetchArticles(env) });
      }

      if (url.pathname === "/api/queue") {
        const result = await env.DB.prepare(`
          SELECT * FROM posts
          WHERE status IN ('draft','scheduled','approved','sending','error','unknown')
          ORDER BY
            CASE status
              WHEN 'sending' THEN 0
              WHEN 'error' THEN 1
              WHEN 'unknown' THEN 2
              WHEN 'scheduled' THEN 3
              WHEN 'approved' THEN 4
              ELSE 5
            END,
            COALESCE(scheduled_at, created_at) ASC
          LIMIT 200
        `).all();

        return json({ ok: true, posts: result.results || [] });
      }

      if (url.pathname === "/api/posts") {
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
        const result = await env.DB.prepare("SELECT * FROM posts ORDER BY id DESC LIMIT ?").bind(limit).all();
        return json({ ok: true, posts: result.results || [] });
      }

      if (url.pathname === "/api/events") {
        const result = await env.DB.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 100").all();
        return json({ ok: true, events: result.results || [] });
      }

      if (url.pathname === "/api/settings/pause" && request.method === "POST") {
        await setSetting(env, "autoPublish", false);
        await setSetting(env, "autoBatchEnabled", false);
        await setSetting(env, "paused", true);
        await logEvent(env, "warning", "Automatización pausada.");
        return json({ ok: true, paused: true });
      }

      if (url.pathname === "/api/settings/resume" && request.method === "POST") {
        await setSetting(env, "paused", false);
        await logEvent(env, "info", "Bot reanudado.");
        return json({ ok: true, paused: false });
      }

      if (url.pathname === "/api/generate" && request.method === "POST") {
        const body = await request.json();
        const count = Math.min(4, Math.max(1, Number(body?.count) || 4));
        const lockToken = await acquireLock(env, "generate", 600);

        if (!lockToken) throw new Error("Ya hay una generación en curso. Espera y vuelve a intentarlo.");

        try {
          const articles = await fetchArticles(env);
          if (articles.length < count) {
            throw new Error(`Solo hay ${articles.length} noticias nuevas para generar ${count} tweets.`);
          }

          const settings = await getSettings(env);
          const batchId = crypto.randomUUID();
          const created = [];

          for (let i = 0; i < count; i++) {
            const article = articles[i];
            const includeLink = i >= count - Math.min(count, settings.linksPerBatch);
            const text = formatTweet(
              await generateTweet(article, env),
              article,
              includeLink,
              settings.maxPostChars
            );

            const result = await env.DB.prepare(`
              INSERT INTO posts(
                article_url,article_title,post_text,status,has_link,
                cost_eur,created_at,batch_id
              ) VALUES(?,?,?,'draft',?,?,?,?)
            `).bind(
              article.url,
              article.title,
              text,
              includeLink ? 1 : 0,
              0,
              new Date().toISOString(),
              batchId
            ).run();

            created.push({
              id: result.meta.last_row_id,
              title: article.title,
              text,
              status: "draft"
            });
          }

          await logEvent(env, "info", `${created.length} tweets generados para revisión.`);
          return json({ ok: true, batchId, posts: created });
        } finally {
          await releaseLock(env, "generate", lockToken);
        }
      }

      if (url.pathname === "/api/posts/save" && request.method === "POST") {
        const body = await request.json();
        const id = Number(body?.id);
        const text = String(body?.text || "").trim();

        if (!Number.isInteger(id) || id < 1) throw new Error("ID de tweet no válido.");
        if (!text) throw new Error("El tweet no puede estar vacío.");
        if (text.length > 280) throw new Error("El tweet supera los 280 caracteres.");

        const result = await env.DB.prepare(`
          UPDATE posts
          SET post_text=?,status='draft',scheduled_at=NULL,error=NULL
          WHERE id=? AND status IN ('draft','scheduled','approved','error')
        `).bind(text, id).run();

        if (!result.meta.changes) throw new Error("No se puede editar este tweet: comprueba su estado.");

        await logEvent(env, "info", `Tweet ${id} editado.`);
        return json({ ok: true, id, text });
      }

      if (url.pathname === "/api/posts/schedule" && request.method === "POST") {
        const body = await request.json();
        const id = Number(body?.id);
        const when = Date.parse(body?.scheduledAt);

        if (!Number.isInteger(id) || id < 1) throw new Error("ID no válido.");
        if (!Number.isFinite(when) || when <= Date.now()) throw new Error("Selecciona una fecha y hora futura.");

        const result = await env.DB.prepare(`
          UPDATE posts
          SET status='scheduled',scheduled_at=?,error=NULL
          WHERE id=? AND status IN ('draft','scheduled','approved','error')
        `).bind(new Date(when).toISOString(), id).run();

        if (!result.meta.changes) throw new Error("No se puede programar este tweet.");

        await logEvent(env, "info", `Tweet ${id} programado para ${new Date(when).toISOString()}.`);
        return json({ ok: true, id, scheduledAt: new Date(when).toISOString() });
      }

      if (url.pathname === "/api/posts/unschedule" && request.method === "POST") {
        const body = await request.json();
        const result = await env.DB.prepare(
          "UPDATE posts SET status='draft',scheduled_at=NULL WHERE id=? AND status='scheduled'"
        ).bind(Number(body?.id)).run();

        if (!result.meta.changes) throw new Error("No se ha podido cancelar la programación.");
        return json({ ok: true });
      }

      if (url.pathname === "/api/posts/delete" && request.method === "POST") {
        const body = await request.json();
        const result = await env.DB.prepare(
          "DELETE FROM posts WHERE id=? AND status IN ('draft','scheduled','approved','error')"
        ).bind(Number(body?.id)).run();

        if (!result.meta.changes) throw new Error("No se puede eliminar un tweet enviado o en proceso.");
        return json({ ok: true });
      }

      if (url.pathname === "/api/posts/publish" && request.method === "POST") {
        const body = await request.json();
        return json(await publishQueuedPost(env, Number(body?.id), true));
      }

      if (url.pathname === "/api/publish-approved" && request.method === "POST") {
        return json(await publishApproved(env));
      }

      if (url.pathname === "/api/run-once" && request.method === "POST") {
        return json(await runCycle(env, true));
      }

      if (url.pathname === "/api/test-ai" && request.method === "POST") {
        if (!env.AI || typeof env.AI.run !== "function") {
          throw new Error("Falta el binding Workers AI llamado AI.");
        }

        const settings = await getSettings(env);
        const result = await env.AI.run(settings.model, {
          messages: [
            { role: "system", content: "Responde únicamente con un texto breve en español." },
            { role: "user", content: "Escribe: VOID AI operativo." }
          ],
          max_tokens: 50
        });

        return json({ ok: true, model: settings.model, response: extractAIText(result) });
      }

      if (url.pathname === "/api/test-x" && request.method === "POST") {
        return json({
          ok: true,
          account: await xRequest("GET", "https://api.x.com/2/users/me", null, env)
        });
      }

      return json({ ok: false, error: "Endpoint no encontrado." }, 404);
    } catch (error) {
      console.error("VOID Autopilot:", error);
      try {
        if (env.DB) await logEvent(env, "error", String(error.stack || error));
      } catch {}

      const status = Number(error.httpStatus) === 401 || Number(error.httpStatus) === 403
        ? Number(error.httpStatus)
        : 500;

      return json({ ok: false, error: String(error.message || error) }, status);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(cronCycle(env).catch(async error => {
      console.error("VOID cron:", error);
      try {
        await logEvent(env, "error", String(error.stack || error));
      } catch {}
    }));
  }
};

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "cache-control": "no-store"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...cors(), "content-type": "application/json; charset=utf-8" }
  });
}

function authorized(request, env) {
  return Boolean(env.ADMIN_TOKEN) &&
    request.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

async function schema(env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS posts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_url TEXT UNIQUE,
      article_title TEXT,
      post_text TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      has_link INTEGER NOT NULL DEFAULT 0,
      cost_eur REAL NOT NULL DEFAULT 0,
      x_post_id TEXT,
      created_at TEXT,
      published_at TEXT,
      error TEXT,
      scheduled_at TEXT,
      batch_id TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'info',
      event TEXT NOT NULL DEFAULT 'legacy_event',
      details TEXT,
      created_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS autopilot_locks(
      name TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at INTEGER NOT NULL
    )`
  ];

  for (const statement of statements) await env.DB.prepare(statement).run();

  for (const statement of [
    "CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)",
    "CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_posts_schedule ON posts(scheduled_at)"
  ]) {
    await env.DB.prepare(statement).run();
  }

  for (const [table, columns] of Object.entries({
    posts: {
      article_url: "TEXT",
      article_title: "TEXT",
      post_text: "TEXT",
      status: "TEXT NOT NULL DEFAULT 'draft'",
      has_link: "INTEGER NOT NULL DEFAULT 0",
      cost_eur: "REAL NOT NULL DEFAULT 0",
      x_post_id: "TEXT",
      created_at: "TEXT",
      published_at: "TEXT",
      error: "TEXT",
      scheduled_at: "TEXT",
      batch_id: "TEXT"
    },
    events: {
      level: "TEXT NOT NULL DEFAULT 'info'",
      event: "TEXT NOT NULL DEFAULT 'legacy_event'",
      details: "TEXT",
      created_at: "TEXT"
    }
  })) {
    const info = await env.DB.prepare(`PRAGMA table_info("${table}")`).all();
    const existing = new Set((info.results || []).map(row => row.name));

    for (const [column, definition] of Object.entries(columns)) {
      if (!existing.has(column)) {
        await env.DB.prepare(
          `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`
        ).run();
      }
    }
  }

  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(DEFAULTS)) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)
    `).bind(key, JSON.stringify(value), now).run();
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES('paused','true',?)
  `).bind(now).run();

  await env.DB.prepare(`
    UPDATE events SET event='legacy_event' WHERE event IS NULL OR event=''
  `).run();

  await env.DB.prepare(`
    UPDATE events SET level='info' WHERE level IS NULL OR level=''
  `).run();

  await env.DB.prepare(`
    UPDATE events SET created_at=? WHERE created_at IS NULL
  `).bind(now).run();
}

async function getSetting(env, key) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();
  if (!row) return undefined;

  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

async function setSetting(env, key, value) {
  await env.DB.prepare(`
    INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET
      value=excluded.value,updated_at=excluded.updated_at
  `).bind(key, JSON.stringify(value), new Date().toISOString()).run();
}

async function getSettings(env) {
  const result = { ...DEFAULTS };
  const rows = await env.DB.prepare("SELECT key,value FROM settings").all();

  for (const row of rows.results || []) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = row.value;
    }
  }

  return result;
}

async function logEvent(env, level, details) {
  await env.DB.prepare(`
    INSERT INTO events(level,event,details,created_at) VALUES(?,?,?,?)
  `).bind(
    level || "info",
    "worker_event",
    String(details || "").slice(0, 3000),
    new Date().toISOString()
  ).run();
}

function normalizeHttpUrl(value, label = "URL") {
  let url;

  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} no válida.`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} debe usar HTTP o HTTPS.`);
  }

  return url.toString();
}

function normalizeRssUrl(value) {
  const url = new URL(normalizeHttpUrl(value, "URL RSS"));

  if (
    url.hostname.replace(/^www\./i, "").toLowerCase() === "noticierovoid.com" &&
    (url.pathname === "/" || !url.pathname)
  ) {
    url.pathname = "/rss.xml";
  }

  return url.toString();
}

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const x = Number(n);
      try { return String.fromCodePoint(x); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; }
    });
}

function xmlTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`;
  const match = String(block).match(new RegExp(pattern, "i"));
  return match ? match[1] : "";
}

function clean(value = "") {
  return decodeXml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchArticles(env) {
  const cfg = await getSettings(env);
  const response = await fetch(normalizeRssUrl(cfg.rssUrl), {
    headers: {
      "user-agent": `VOID-Autopilot/${VERSION}`,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) throw new Error(`RSS HTTP ${response.status}`);

  const xml = await response.text();
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)];
  const articles = [];
  const now = Date.now();

  for (const match of blocks) {
    const block = match[0];
    const atom = /^<entry\b/i.test(block);
    const title = clean(xmlTag(block, "title"));
    let link = xmlTag(block, "link");

    if (atom) {
      const links = [...block.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
      const selected = links.find(item => {
        const rel = item[1].match(/\brel=["']([^"']+)["']/i);
        return !rel || rel[1] === "alternate";
      }) || links[0];

      link = selected?.[1].match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
    }

    const description = clean(
      xmlTag(block, "description") ||
      xmlTag(block, "summary") ||
      xmlTag(block, "content:encoded") ||
      xmlTag(block, "content")
    );

    const dateText =
      xmlTag(block, "pubDate") ||
      xmlTag(block, "published") ||
      xmlTag(block, "updated") ||
      xmlTag(block, "dc:date");

    const timestamp = Date.parse(decodeXml(dateText));
    const articleUrl = decodeXml(link).trim();

    if (!title || !Number.isFinite(timestamp)) continue;
    if (!/^https?:\/\//i.test(articleUrl)) continue;

    const ageHours = (now - timestamp) / 3600000;
    if (ageHours < -1 || ageHours > Number(cfg.maxArticleAgeHours)) continue;

    const existing = await env.DB.prepare(
      "SELECT id FROM posts WHERE article_url=?"
    ).bind(articleUrl).first();

    if (existing) continue;

    articles.push({
      title,
      url: articleUrl,
      description: description.slice(0, 2500),
      publishedAt: new Date(timestamp).toISOString(),
      ageHours
    });
  }

  const seen = new Set();

  return articles
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter(article => {
      if (seen.has(article.url)) return false;
      seen.add(article.url);
      return true;
    });
}

function extractAIText(result) {
  if (typeof result === "string") return result.trim();
  if (!result || typeof result !== "object") return "";

  for (const key of ["response", "output_text", "text", "result"]) {
    if (typeof result[key] === "string") return result[key].trim();
  }

  if (Array.isArray(result.content)) {
    return result.content.map(x => typeof x === "string" ? x : x?.text || "").join(" ").trim();
  }

  if (Array.isArray(result.choices)) {
    return result.choices.map(x => x?.message?.content || x?.text || "").join(" ").trim();
  }

  return "";
}

async function generateTweet(article, env) {
  if (!env.AI || typeof env.AI.run !== "function") {
    throw new Error("Falta el binding Workers AI llamado AI.");
  }

  const cfg = await getSettings(env);

  const prompt = [
    "Escribe un tweet periodístico profesional para Noticiero VOID.",
    "Idioma: español de España. No inventes hechos, datos, cifras ni declaraciones.",
    "No incluyas hashtags, emojis ni enlaces. Máximo 200 caracteres.",
    "Devuelve exclusivamente el texto final del tweet.",
    "",
    "TÍTULO: " + article.title,
    "DESCRIPCIÓN: " + article.description.slice(0, 1800)
  ].join("\n");

  const result = await env.AI.run(cfg.model, {
    messages: [
      { role: "system", content: "Eres un editor de noticias riguroso. No inventes información." },
      { role: "user", content: prompt }
    ],
    max_tokens: 220
  });

  const text = extractAIText(result)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^`(?:text)?/i, "")
    .replace(/`$/i, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 15) {
    await logEvent(
      env,
      "error",
      "Workers AI no devolvió texto utilizable: " + JSON.stringify(result).slice(0, 1000)
    );
    throw new Error(`La IA no generó un tweet válido para: ${article.title}`);
  }

  return text;
}

function formatTweet(text, article, includeLink, maxChars) {
  const suffix = includeLink ? "\n" + article.url : "";
  const limit = Math.min(280, Number(maxChars)) - suffix.length;

  if (limit < 20) throw new Error("El enlace es demasiado largo para el límite configurado.");

  let body = String(text).trim();
  if (body.length > limit) body = body.slice(0, limit - 1).trimEnd() + "…";

  return body + suffix;
}

async function acquireLock(env, name = "cycle", seconds = 600) {
  const now = Date.now();
  const token = crypto.randomUUID();

  await env.DB.prepare("DELETE FROM autopilot_locks WHERE expires_at<?").bind(now).run();

  try {
    await env.DB.prepare(
      "INSERT INTO autopilot_locks(name,token,expires_at) VALUES(?,?,?)"
    ).bind(name, token, now + seconds * 1000).run();

    return token;
  } catch {
    return null;
  }
}

async function releaseLock(env, name, token) {
  await env.DB.prepare(
    "DELETE FROM autopilot_locks WHERE name=? AND token=?"
  ).bind(name, token).run();
}

async function publishQueuedPost(env, id, manual = false) {
  if (!Number.isInteger(id) || id < 1) throw new Error("ID no válido.");

  const lockName = `post-${id}`;
  const lock = await acquireLock(env, lockName, 180);
  if (!lock) return { ok: false, error: "Este tweet ya está en proceso." };

  try {
    const post = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(id).first();

    if (!post) throw new Error("No se encuentra el tweet.");
    if (!["draft", "scheduled", "approved", "error"].includes(post.status)) {
      throw new Error("Este tweet no se puede publicar en su estado actual.");
    }
    if (!post.post_text?.trim()) throw new Error("El tweet está vacío.");
    if (post.post_text.length > 280) throw new Error("El tweet supera el límite de X.");

    const settings = await getSettings(env);
    if (!manual && await getSetting(env, "paused")) throw new Error("Bot pausado.");

    const today = dateInZone(new Date(), settings.timezone);

    const count = await env.DB.prepare(`
      SELECT COUNT(*) AS total FROM posts
      WHERE status IN ('published','sending','unknown')
      AND substr(COALESCE(published_at,created_at),1,10)=?
    `).bind(today).first();

    if (Number(count?.total || 0) >= Number(settings.maxPostsPerDay)) {
      throw new Error("Se ha alcanzado el límite diario configurado.");
    }

    if (Number(post.has_link)) {
      const linked = await env.DB.prepare(`
        SELECT COUNT(*) AS total FROM posts
        WHERE status IN ('published','sending','unknown')
        AND has_link=1
        AND substr(COALESCE(published_at,created_at),1,10)=?
      `).bind(today).first();

      if (Number(linked?.total || 0) >= Number(settings.maxLinkedPerDay)) {
        throw new Error("Se ha alcanzado el límite diario de tweets con enlace.");
      }
    }

    const estimate = (
      Number(post.has_link) ? Number(settings.urlPostUsd) : Number(settings.normalPostUsd)
    ) * Number(settings.usdToEurRate);

    const month = dateInZone(new Date(), settings.timezone).slice(0, 7);

    const spent = await env.DB.prepare(`
      SELECT COALESCE(SUM(cost_eur),0) AS total FROM posts
      WHERE status IN ('published','sending','unknown')
      AND substr(COALESCE(published_at,created_at),1,7)=?
    `).bind(month).first();

    const budget = Math.min(Number(settings.monthlyBudgetEur), Number(settings.hardStopEur));

    if (Number(spent?.total || 0) + estimate > budget) {
      throw new Error("El presupuesto configurado no permite publicar este tweet.");
    }

    const update = await env.DB.prepare(`
      UPDATE posts SET status='sending',cost_eur=?,error=NULL
      WHERE id=? AND status IN ('draft','scheduled','approved','error')
    `).bind(estimate, id).run();

    if (!update.meta.changes) throw new Error("El estado del tweet ha cambiado. Actualiza la cola.");

    try {
      const result = await publishX(post.post_text, env);
      const xId = result?.data?.id;

      await env.DB.prepare(`
        UPDATE posts SET status='published',x_post_id=?,published_at=?,error=NULL WHERE id=?
      `).bind(xId || null, new Date().toISOString(), id).run();

      await logEvent(env, "info", `Tweet ${id} publicado en X.`);
      return { ok: true, id, xPostId: xId || null, text: post.post_text };
    } catch (error) {
      const code = Number(error.httpStatus || 0);
      const status = code === 0 || code >= 500 ? "unknown" : "error";

      await env.DB.prepare("UPDATE posts SET status=?,error=? WHERE id=?")
        .bind(status, String(error.message || error).slice(0, 2000), id).run();

      if (code === 402) {
        await setSetting(env, "autoPublish", false);
        await setSetting(env, "autoBatchEnabled", false);
      }

      throw error;
    }
  } finally {
    await releaseLock(env, lockName, lock);
  }
}

async function publishApproved(env) {
  const rows = await env.DB.prepare(`
    SELECT id FROM posts WHERE status='approved' ORDER BY created_at ASC LIMIT 4
  `).all();

  const results = [];

  for (let i = 0; i < (rows.results || []).length; i++) {
    try {
      results.push(await publishQueuedPost(env, rows.results[i].id, true));
      const cfg = await getSettings(env);

      if (i < rows.results.length - 1 && cfg.tweetSpacingSeconds > 0) {
        await new Promise(resolve => setTimeout(
          resolve,
          Math.min(120, cfg.tweetSpacingSeconds) * 1000
        ));
      }
    } catch (error) {
      results.push({
        ok: false,
        id: rows.results[i].id,
        error: String(error.message || error)
      });
      break;
    }
  }

  return { ok: results.every(x => x.ok), results };
}

async function runCycle(env, manual) {
  if (!manual && await getSetting(env, "paused")) {
    return { ok: true, skipped: true, reason: "paused" };
  }

  const token = await acquireLock(env, "cycle", 900);
  if (!token) return { ok: false, skipped: true, reason: "already_running" };

  try {
    const settings = await getSettings(env);
    const articles = await fetchArticles(env);
    const count = Math.min(4, Math.max(1, Number(settings.batchSize) || 4));

    if (articles.length < count) {
      return {
        ok: false,
        reason: "not_enough_articles",
        available: articles.length,
        required: count
      };
    }

    const batchId = crypto.randomUUID();
    const created = [];

    for (let i = 0; i < count; i++) {
      const article = articles[i];
      const includeLink = i >= count - Math.min(count, settings.linksPerBatch);
      const text = formatTweet(
        await generateTweet(article, env),
        article,
        includeLink,
        settings.maxPostChars
      );

      const result = await env.DB.prepare(`
        INSERT INTO posts(
          article_url,article_title,post_text,status,has_link,cost_eur,created_at,batch_id
        ) VALUES(?,?,?,'draft',?,?,?,?)
      `).bind(
        article.url,
        article.title,
        text,
        includeLink ? 1 : 0,
        0,
        new Date().toISOString(),
        batchId
      ).run();

      created.push({
        id: result.meta.last_row_id,
        title: article.title,
        text,
        status: "draft"
      });
    }

    await logEvent(env, "info", `${created.length} tweets generados para revisión manual.`);
    return { ok: true, batchId, generated: created.length, posts: created };
  } finally {
    await releaseLock(env, "cycle", token);
  }
}

async function cronCycle(env) {
  await schema(env);
  const settings = await getSettings(env);
  const now = new Date();

  if (settings.autoPublish && !(await getSetting(env, "paused"))) {
    const due = await env.DB.prepare(`
      SELECT id FROM posts
      WHERE status='scheduled' AND scheduled_at<=?
      ORDER BY scheduled_at ASC LIMIT 4
    `).bind(now.toISOString()).all();

    for (let i = 0; i < (due.results || []).length; i++) {
      try {
        await publishQueuedPost(env, due.results[i].id, false);

        if (i < due.results.length - 1 && settings.tweetSpacingSeconds > 0) {
          await new Promise(resolve => setTimeout(
            resolve,
            Math.min(120, settings.tweetSpacingSeconds) * 1000
          ));
        }
      } catch (error) {
        await logEvent(env, "error", `Programación ${due.results[i].id}: ${error.message || error}`);
      }
    }
  }

  if (!settings.autoBatchEnabled || await getSetting(env, "paused")) return;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);

  const hour = Number(parts.find(x => x.type === "hour")?.value);
  const minute = Number(parts.find(x => x.type === "minute")?.value);
  const interval = Math.max(1, Number(settings.autoBatchIntervalHours) || 3);

  if (minute !== 0 || hour % interval !== 0) return;

  const localDate = dateInZone(now, settings.timezone);
  const key = `last_auto_batch_${localDate}_${String(hour).padStart(2, "0")}`;

  if (await getSetting(env, key)) return;

  await setSetting(env, key, true);

  try {
    await runCycle(env, false);
  } catch (error) {
    await setSetting(env, key, false);
    throw error;
  }
}

function dateInZone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function getStatus(env) {
  const settings = await getSettings(env);
  const paused = Boolean(await getSetting(env, "paused"));
  const today = dateInZone(new Date(), settings.timezone);
  const month = today.slice(0, 7);

  const [daily, spending, totals, queue] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS total,COALESCE(SUM(has_link),0) AS links
      FROM posts WHERE status='published' AND substr(published_at,1,10)=?
    `).bind(today).first(),

    env.DB.prepare(`
      SELECT COALESCE(SUM(cost_eur),0) AS total FROM posts
      WHERE status IN ('published','sending','unknown')
      AND substr(COALESCE(published_at,created_at),1,7)=?
    `).bind(month).first(),

    env.DB.prepare(`
      SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors
      FROM posts
    `).first(),

    env.DB.prepare(`
      SELECT
        SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS drafts,
        SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) AS scheduled
      FROM posts
    `).first()
  ]);

  const budget = Math.min(Number(settings.monthlyBudgetEur), Number(settings.hardStopEur));
  const spent = Number(spending?.total || 0);

  return {
    ok: true,
    version: VERSION,
    paused,
    settings,
    today,
    publishedToday: Number(daily?.total || 0),
    linkedToday: Number(daily?.links || 0),
    monthlyCostEur: spent,
    monthlyBudgetEur: budget,
    remainingBudgetEur: Math.max(0, budget - spent),
    totals,
    queue
  };
}

async function xRequest(method, endpoint, payload, env) {
  const required = [
    "X_CONSUMER_KEY",
    "X_CONSUMER_SECRET",
    "X_ACCESS_TOKEN",
    "X_ACCESS_TOKEN_SECRET"
  ];

  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error("Faltan secretos X: " + missing.join(", "));

  const authorization = await oauthHeader(method, endpoint, env);

  const response = await fetch(endpoint, {
    method,
    headers: {
      authorization,
      ...(payload ? { "content-type": "application/json" } : {})
    },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(20000)
  });

  const body = await response.text();

  if (!response.ok) {
    const error = new Error(`X API HTTP ${response.status}: ${body.slice(0, 1200)}`);
    error.httpStatus = response.status;
    throw error;
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("X devolvió una respuesta no válida.");
  }
}

async function publishX(text, env) {
  return xRequest("POST", "https://api.x.com/2/tweets", { text }, env);
}

async function oauthHeader(method, endpoint, env) {
  const encode = value => encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    char => "%" + char.charCodeAt(0).toString(16).toUpperCase()
  );

  const oauth = {
    oauth_consumer_key: env.X_CONSUMER_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0"
  };

  const params = Object.entries(oauth)
    .map(([key, value]) => [encode(key), encode(value)])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 :
      a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const base = [method.toUpperCase(), encode(endpoint), encode(params)].join("&");
  const signingKey = `${encode(env.X_CONSUMER_SECRET)}&${encode(env.X_ACCESS_TOKEN_SECRET)}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(base)
  );

  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);

  oauth.oauth_signature = btoa(binary);

  return "OAuth " + Object.entries(oauth)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`)
    .join(", ");
}

function dashboard() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#080b12">
<title>VOID Autopilot — Control Center</title>
<style>
:root{color-scheme:dark;--bg:#080b12;--panel:#101622;--panel2:#151e2d;--line:#273247;--text:#e9eef7;--muted:#8c9ab0;--cyan:#73e1d0;--blue:#8ba8ff;--red:#ff7285;--green:#68e0aa;--amber:#ffc878}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
button,input,textarea,select{font:inherit}
button{cursor:pointer}
button:disabled{opacity:.45;cursor:not-allowed}
.shell{min-height:100vh;display:grid;grid-template-columns:238px minmax(0,1fr)}
aside{position:sticky;top:0;height:100vh;border-right:1px solid var(--line);padding:22px 14px;background:#0b1019;display:flex;flex-direction:column;gap:22px}
.brand{display:flex;align-items:center;gap:11px;padding:0 8px}
.logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,#8cf5dc,#6f9cff);color:#07121b;display:grid;place-items:center;font-weight:1000;font-size:19px}
.brand strong{font-size:15px;letter-spacing:.08em}.brand small{display:block;color:var(--muted);font-size:11px}
.nav{display:grid;gap:5px}
.nav button{width:100%;text-align:left;background:transparent;color:#9ba8bc;border:1px solid transparent;padding:11px 12px;border-radius:10px;display:flex;gap:11px;align-items:center}
.nav button.active,.nav button:hover{background:#172233;color:var(--text);border-color:#283a51}
.nav .glyph{width:20px;text-align:center;font-size:16px}
.aside-bottom{margin-top:auto;border:1px solid var(--line);border-radius:12px;padding:13px;background:#101723}
.dot{display:inline-block;width:7px;height:7px;background:var(--green);border-radius:50%;margin-right:7px}
main{min-width:0;padding:27px clamp(15px,3vw,38px) 60px;max-width:1600px;width:100%;margin:auto}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:26px}
.eyebrow{color:var(--cyan);text-transform:uppercase;letter-spacing:.16em;font-size:10px;font-weight:800}
h1{font-size:clamp(25px,3vw,35px);letter-spacing:-.04em;margin:4px 0 3px}
h2{font-size:17px;margin:0 0 15px}
p{margin-top:0}.muted{color:var(--muted)}.small{font-size:12px}
.top-actions,.actions,.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.btn{border:1px solid var(--line);border-radius:9px;background:#172132;color:var(--text);padding:10px 13px;font-weight:700}
.btn:hover{filter:brightness(1.13)}
.btn.primary{background:var(--cyan);border-color:var(--cyan);color:#07161a}
.btn.blue{background:#263a60;border-color:#385080}
.btn.danger{color:#ff9eaa;border-color:#63303b;background:#27151e}
.btn.smallbtn{padding:7px 9px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:17px;min-width:0}
.metric-label{font-size:12px;color:var(--muted)}.metric{font-size:29px;font-weight:800;letter-spacing:-.05em;margin:8px 0 3px}.metric-foot{font-size:11px;color:var(--muted)}
.layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(270px,.8fr);gap:14px}
.stack{display:grid;gap:14px;align-content:start}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.section-head h2{margin:0}
.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:99px;padding:4px 8px;font-size:11px;color:var(--muted)}
.pill.good{color:var(--green);border-color:#285744}.pill.warn{color:var(--amber);border-color:#5c482c}.pill.bad{color:var(--red);border-color:#5d2b39}
.formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.field{display:grid;gap:6px;min-width:0}.field label{color:#aab7ca;font-size:12px}
.field input,.field textarea,.field select,.search{width:100%;min-width:0;background:#0b111c;color:var(--text);border:1px solid #2b384d;border-radius:9px;padding:10px 11px;outline:none}
.field input:focus,.field textarea:focus,.field select:focus,.search:focus{border-color:var(--cyan)}
.field textarea{min-height:112px;resize:vertical}
.span2{grid-column:1/-1}
.switchrow{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:9px}
.switchrow strong{display:block;font-size:13px}.switchrow small{color:var(--muted)}
.switch{width:42px;height:24px;appearance:none;background:#354056;border-radius:30px;position:relative;cursor:pointer;flex-shrink:0}
.switch:checked{background:#4ebcae}.switch:before{content:"";position:absolute;width:18px;height:18px;top:3px;left:3px;border-radius:50%;background:white;transition:.15s}
.switch:checked:before{left:21px}
.progress{height:6px;background:#253044;border-radius:20px;overflow:hidden;margin:10px 0}
.progress span{display:block;height:100%;background:var(--cyan);width:0}
.list{display:grid;gap:10px}
.item{border:1px solid var(--line);border-radius:12px;padding:13px;background:#0d131e;min-width:0}
.itemtop{display:flex;justify-content:space-between;gap:10px;align-items:start}
.itemtitle{font-weight:750;font-size:13px;overflow-wrap:anywhere}
.itembody{color:#bdc8d8;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;font-size:13px}
.itemmeta{color:var(--muted);font-size:11px;overflow-wrap:anywhere}
.item textarea{width:100%;min-height:110px;background:#080d16;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px;resize:vertical}
.empty{padding:24px;text-align:center;color:var(--muted);border:1px dashed #2b384d;border-radius:11px}
.view{display:none}.view.active{display:block}
table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:10px 7px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
.tablewrap{overflow:auto}
#toast{position:fixed;bottom:20px;right:20px;max-width:min(440px,calc(100vw - 40px));padding:13px 17px;background:#182536;border:1px solid #38516c;border-radius:11px;box-shadow:0 12px 50px #0008;z-index:20;display:none;overflow-wrap:anywhere}
#toast.error{border-color:#9c4355;color:#ffc3cc}
#mobileMenu{display:none}
@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.layout{grid-template-columns:1fr}}
@media(max-width:680px){.shell{grid-template-columns:1fr}aside{height:auto;position:relative;padding:12px;border-right:0;border-bottom:1px solid var(--line);gap:12px}.brand{padding:3px}.nav{display:flex;overflow:auto}.nav button{white-space:nowrap;width:auto;padding:9px}.aside-bottom{display:none}main{padding:18px 12px 45px}.topbar{align-items:start}.top-actions{justify-content:flex-end}.top-actions .btn{padding:8px;font-size:11px}.grid{gap:8px}.card{padding:13px}.metric{font-size:24px}.formgrid{grid-template-columns:1fr}.span2{grid-column:auto}.section-head{align-items:start}.layout{gap:10px}}
</style>
</head>
<body>
<div class="shell">
<aside>
  <div class="brand">
    <div class="logo">V</div>
    <div><strong>VOID AUTOPILOT</strong><small>CONTROL CENTER · 8.1</small></div>
  </div>
  <nav class="nav">
    <button class="active" data-view="overview"><span class="glyph">◫</span>Resumen</button>
    <button data-view="composer"><span class="glyph">✎</span>Editor de tweets</button>
    <button data-view="queue"><span class="glyph">☷</span>Cola de publicación</button>
    <button data-view="news"><span class="glyph">◉</span>Noticias RSS</button>
    <button data-view="automation"><span class="glyph">⏱</span>Automatización</button>
    <button data-view="settings"><span class="glyph">⚙</span>Configuración</button>
    <button data-view="history"><span class="glyph">↗</span>Historial y errores</button>
  </nav>
  <div class="aside-bottom">
    <div class="small"><span class="dot" id="sideDot"></span><span id="sideState">Conecta para ver el estado</span></div>
    <p class="small muted" style="margin:9px 0 0">Noticiero VOID<br>Control de publicación X</p>
  </div>
</aside>

<main>
<header class="topbar">
  <div>
    <div class="eyebrow">Publishing intelligence</div>
    <h1 id="pageTitle">Resumen</h1>
    <div class="muted small" id="pageSub">Control de actividad, noticias y publicaciones.</div>
  </div>
  <div class="top-actions">
    <button class="btn" id="refreshBtn">↻ Actualizar</button>
    <button class="btn primary" id="generateTop">+ Generar tweets</button>
  </div>
</header>

<section class="view active" id="view-overview">
  <div class="grid">
    <div class="card"><div class="metric-label">Publicados hoy</div><div class="metric" id="mPublished">—</div><div class="metric-foot" id="mDailySub">Tweets en X</div></div>
    <div class="card"><div class="metric-label">Pendientes</div><div class="metric" id="mQueue">—</div><div class="metric-foot">Borradores y programados</div></div>
    <div class="card"><div class="metric-label">Presupuesto mensual</div><div class="metric" id="mBudget">—</div><div class="metric-foot" id="mBudgetSub">Coste estimado</div><div class="progress"><span id="budgetBar"></span></div></div>
    <div class="card"><div class="metric-label">Errores registrados</div><div class="metric" id="mErrors">—</div><div class="metric-foot">Revisa el historial</div></div>
  </div>

  <div class="layout">
    <div class="stack">
      <div class="card">
        <div class="section-head"><h2>Centro de publicación</h2><span class="pill" id="modePill">Sin conectar</span></div>
        <p class="muted small">Genera una tanda de noticias, revisa el texto y decide cuándo publicarlo.</p>
        <div class="actions">
          <button class="btn primary" id="genFour">Generar 4 borradores</button>
          <button class="btn" id="publishApproved">Publicar aprobados</button>
          <button class="btn" id="openQueue">Abrir cola</button>
        </div>
      </div>

      <div class="card">
        <div class="section-head"><h2>Cola reciente</h2><button class="btn smallbtn" data-goto="queue">Ver toda →</button></div>
        <div id="overviewQueue" class="list"><div class="empty">Conecta el panel para cargar la cola.</div></div>
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="section-head"><h2>Modo de operación</h2><span class="pill" id="pausePill">—</span></div>
        <div class="switchrow"><div><strong>Publicación automática</strong><small>Envía los tweets programados cuando vencen.</small></div><input id="autoPublish" class="switch" type="checkbox"></div>
        <div class="switchrow"><div><strong>Generar tandas automáticamente</strong><small>Crea nuevos borradores según el intervalo.</small></div><input id="autoBatch" class="switch" type="checkbox"></div>
        <div class="actions"><button class="btn" id="saveMode">Guardar modo</button><button class="btn danger" id="pauseBtn">Pausar todo</button></div>
      </div>

      <div class="card">
        <h2>Conexión segura</h2>
        <div class="field"><label>ADMIN_TOKEN</label><input id="token" type="password" placeholder="Token del Worker" autocomplete="current-password"></div>
        <div class="actions" style="margin-top:10px"><button class="btn primary" id="connectBtn">Conectar panel</button><button class="btn" id="testX">Probar X</button><button class="btn" id="testAI">Probar IA</button></div>
        <p class="muted small" style="margin:10px 0 0">El token se conserva solo en esta página abierta.</p>
      </div>
    </div>
  </div>
</section>

<section class="view" id="view-composer">
  <div class="layout">
    <div class="card">
      <div class="section-head"><h2>Editor de contenido</h2><span class="pill">Máximo 280 caracteres</span></div>
      <div class="field"><label>Selecciona un borrador</label><select id="editSelect"><option value="">Selecciona un tweet de la cola</option></select></div>
      <div class="field" style="margin-top:13px"><label>Texto editable</label><textarea id="editText" maxlength="280" placeholder="Selecciona un borrador o genera nuevos tweets…"></textarea></div>
      <div class="section-head" style="margin-top:7px"><span class="muted small" id="charCount">0 / 280</span><span class="muted small" id="editStatus">Sin selección</span></div>
      <div class="actions">
        <button class="btn primary" id="saveDraft">Guardar edición</button>
        <button class="btn" id="publishOne">Publicar ahora</button>
        <button class="btn" id="scheduleOne">Programar</button>
      </div>
      <div class="field" style="margin-top:17px"><label>Fecha y hora de publicación</label><input id="scheduleDate" type="datetime-local"></div>
      <p class="muted small" style="margin-top:8px">La fecha se convierte a UTC para guardarla. La publicación requiere que el cron esté activo y que el modo automático esté habilitado.</p>
    </div>

    <div class="stack">
      <div class="card"><h2>Vista previa</h2><div class="item"><div class="itemtop"><strong>Noticiero VOID</strong><span class="muted small">@VOID</span></div><div class="itembody" id="previewText">Aquí aparecerá el tweet antes de publicarlo.</div><div class="itemmeta">Vista previa del texto · X</div></div></div>
      <div class="card"><h2>Acciones rápidas</h2><div class="list">
        <button class="btn" id="generateOne">Generar 1 tweet</button>
        <button class="btn" id="generateFour2">Generar 4 borradores</button>
        <button class="btn" id="cancelSchedule">Cancelar programación</button>
      </div></div>
    </div>
  </div>
</section>

<section class="view" id="view-queue">
  <div class="card">
    <div class="section-head"><h2>Cola de publicación</h2><div class="toolbar"><input class="search" id="queueSearch" placeholder="Buscar tweet…" style="max-width:220px"><button class="btn primary" id="queueGenerate">Generar tanda</button><button class="btn" id="queueRefresh">Actualizar</button></div></div>
    <p class="muted small">Edita, programa, publica o elimina los borradores. Los tweets enviados no se pueden borrar desde este panel.</p>
    <div id="queueList" class="list"><div class="empty">No se ha cargado la cola.</div></div>
  </div>
</section>

<section class="view" id="view-news">
  <div class="card">
    <div class="section-head"><h2>Feed RSS</h2><button class="btn primary" id="loadNews">Actualizar noticias</button></div>
    <p class="muted small">Noticias recientes disponibles en el feed configurado.</p>
    <div id="newsList" class="list"><div class="empty">Pulsa actualizar para consultar el RSS.</div></div>
  </div>
</section>

<section class="view" id="view-automation">
  <div class="layout">
    <div class="card">
      <h2>Planificador automático</h2>
      <div class="switchrow"><div><strong>Generar tandas periódicamente</strong><small>Prepara nuevos borradores con noticias nuevas.</small></div><input id="autoBatch2" type="checkbox" class="switch"></div>
      <div class="switchrow"><div><strong>Publicar tweets programados</strong><small>Envía los tweets que hayan llegado a su hora.</small></div><input id="autoPublish2" type="checkbox" class="switch"></div>
      <div class="formgrid">
        <div class="field"><label>Tweets por tanda</label><select id="batchSize"><option>1</option><option>2</option><option>3</option><option selected>4</option></select></div>
        <div class="field"><label>Intervalo de generación (horas)</label><select id="intervalHours"><option>1</option><option>2</option><option selected>3</option><option>4</option><option>6</option><option>8</option><option>12</option><option>24</option></select></div>
        <div class="field"><label>Enlaces por tanda</label><select id="linksPerBatch"><option>0</option><option selected>1</option><option>2</option><option>3</option><option>4</option></select></div>
        <div class="field"><label>Límite de tweets diarios</label><input id="maxPostsPerDay" type="number" min="1" max="100" value="32"></div>
      </div>
      <div class="actions" style="margin-top:15px"><button class="btn primary" id="saveAutomation">Guardar automatización</button><button class="btn danger" id="pauseAll2">Pausar todo</button></div>
    </div>

    <div class="stack">
      <div class="card"><h2>Cómo funciona</h2><ol class="muted small" style="padding-left:19px;line-height:1.9"><li>El cron revisa los tweets programados.</li><li>La generación automática prepara borradores con noticias nuevas.</li><li>Si activas publicación automática, los programados se envían al llegar su hora.</li><li>Los borradores manuales no se publican hasta que pulses Publicar.</li></ol></div>
      <div class="card"><h2>Programación activa</h2><div class="metric" id="scheduleMetric">Cada 3 h</div><p class="muted small" id="scheduleText">Configura el intervalo y guarda.</p></div>
    </div>
  </div>
</section>

<section class="view" id="view-settings">
  <div class="card">
    <div class="section-head"><h2>Configuración avanzada</h2><button class="btn primary" id="saveSettings">Guardar cambios</button></div>
    <div class="formgrid">
      <div class="field span2"><label>URL de la web</label><input id="siteUrl" value="https://noticierovoid.com"></div>
      <div class="field span2"><label>URL del feed RSS</label><input id="rssUrl" value="https://noticierovoid.com/rss.xml"></div>
      <div class="field"><label>Modelo Workers AI</label><input id="model" value="@cf/zai-org/glm-4.7-flash"></div>
      <div class="field"><label>Antigüedad máxima de noticia (horas)</label><input id="maxArticleAgeHours" type="number" min="1" max="720" value="72"></div>
      <div class="field"><label>Longitud máxima del tweet</label><input id="maxPostChars" type="number" min="50" max="280" value="280"></div>
      <div class="field"><label>Zona horaria</label><input id="timezone" value="Europe/Madrid"></div>
      <div class="field"><label>Presupuesto mensual (€)</label><input id="monthlyBudgetEur" type="number" min="0" step=".5" value="10"></div>
      <div class="field"><label>Tope de gasto (€)</label><input id="hardStopEur" type="number" min="0" step=".5" value="8"></div>
      <div class="field"><label>Estimación tweet normal (USD)</label><input id="normalPostUsd" type="number" min="0" step=".001" value=".015"></div>
      <div class="field"><label>Estimación tweet con enlace (USD)</label><input id="urlPostUsd" type="number" min="0" step=".01" value=".20"></div>
      <div class="field"><label>Conversión USD → EUR</label><input id="usdToEurRate" type="number" min="0" step=".01" value="1.05"></div>
      <div class="field"><label>Separación entre tweets (segundos)</label><input id="tweetSpacingSeconds" type="number" min="0" max="120" value="15"></div>
    </div>
  </div>
</section>

<section class="view" id="view-history">
  <div class="card">
    <div class="section-head"><h2>Historial de publicaciones</h2><button class="btn" id="loadHistory">Actualizar historial</button></div>
    <div class="tablewrap"><table><thead><tr><th>ID</th><th>Estado</th><th>Tweet</th><th>Fecha</th><th>Error</th></tr></thead><tbody id="historyRows"><tr><td colspan="5">Conecta para cargar datos.</td></tr></tbody></table></div>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="section-head"><h2>Registro de eventos</h2><button class="btn" id="loadEvents">Actualizar eventos</button></div>
    <div id="eventList" class="list"></div>
  </div>
</section>
</main>
</div>
<div id="toast" role="status" aria-live="polite"></div>

<script>
const $ = id => document.getElementById(id);
const token = () => $("token").value.trim();
let settings = {};
let queue = [];
let selectedId = null;
let busy = false;
let toastTimer;

const titles = {
  overview: ["Resumen", "Control de actividad, noticias y publicaciones."],
  composer: ["Editor de tweets", "Edita, previsualiza y programa cada publicación."],
  queue: ["Cola de publicación", "Control individual de borradores y programaciones."],
  news: ["Noticias RSS", "Fuentes disponibles para generar nuevos contenidos."],
  automation: ["Automatización", "Configura el modo automático y sus intervalos."],
  settings: ["Configuración", "Ajustes de contenido, límites y presupuesto."],
  history: ["Historial y errores", "Seguimiento de las publicaciones y eventos del Worker."]
};

function toast(message, error = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = error ? "error" : "";
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.style.display = "none", 6500);
}

async function api(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: {
      authorization: "Bearer " + token(),
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store"
  });

  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw Error("Respuesta HTTP " + response.status + ": " + raw.slice(0, 300));
  }

  if (!response.ok || data.ok === false) {
    throw Error(data.error || data.message || "Error HTTP " + response.status);
  }

  return data;
}

async function runTask(label, fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach(button => button.disabled = true);

  try {
    await fn();
    if (label) toast(label);
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach(button => button.disabled = false);
  }
}

function showView(name) {
  document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
  $("view-" + name).classList.add("active");
  document.querySelectorAll("[data-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  $("pageTitle").textContent = titles[name][0];
  $("pageSub").textContent = titles[name][1];
}

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

document.querySelectorAll("[data-goto]").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.goto));
});

$("refreshBtn").onclick = () => runTask("Panel actualizado.", refreshAll);
$("connectBtn").onclick = () => runTask("Conexión correcta.", refreshAll);
$("generateTop").onclick = () => runTask("", () => generate(4));
$("genFour").onclick = () => runTask("", () => generate(4));
$("generateFour2").onclick = () => runTask("", () => generate(4));
$("generateOne").onclick = () => runTask("", () => generate(1));
$("queueGenerate").onclick = () => runTask("", () => generate(4));
$("openQueue").onclick = () => showView("queue");
$("queueRefresh").onclick = () => runTask("Cola actualizada.", loadQueue);
$("loadNews").onclick = () => runTask("Feed actualizado.", loadNews);
$("loadHistory").onclick = () => runTask("Historial actualizado.", loadHistory);
$("loadEvents").onclick = () => runTask("Eventos actualizados.", loadEvents);

$("testX").onclick = () => runTask("", async () => {
  const data = await api("/api/test-x", "POST", {});
  toast("Conexión X correcta: " + JSON.stringify(data.account.data || data.account));
});

$("testAI").onclick = () => runTask("", async () => {
  const data = await api("/api/test-ai", "POST", {});
  toast("Workers AI responde: " + data.response);
});

$("publishApproved").onclick = () => runTask("", async () => {
  const data = await api("/api/publish-approved", "POST", {});
  toast(JSON.stringify(data));
  await refreshAll();
});

$("saveDraft").onclick = () => runTask("Borrador guardado.", saveSelected);
$("publishOne").onclick = () => runTask("", publishSelected);
$("scheduleOne").onclick = () => runTask("Tweet programado.", scheduleSelected);
$("cancelSchedule").onclick = () => runTask("Programación cancelada.", unscheduleSelected);
$("saveAutomation").onclick = () => runTask("Automatización guardada.", saveAutomation);
$("saveSettings").onclick = () => runTask("Configuración guardada.", saveSettings);
$("saveMode").onclick = () => runTask("Modo guardado.", saveMode);
$("pauseBtn").onclick = () => runTask("Automatización pausada.", pauseAll);
$("pauseAll2").onclick = () => runTask("Automatización pausada.", pauseAll);

$("autoPublish").onchange = () => { $("autoPublish2").checked = $("autoPublish").checked; };
$("autoPublish2").onchange = () => { $("autoPublish").checked = $("autoPublish2").checked; };
$("autoBatch").onchange = () => { $("autoBatch2").checked = $("autoBatch").checked; };
$("autoBatch2").onchange = () => { $("autoBatch").checked = $("autoBatch2").checked; };

$("editText").addEventListener("input", () => {
  $("charCount").textContent = $("editText").value.length + " / 280";
  $("previewText").textContent = $("editText").value || "Aquí aparecerá el tweet antes de publicarlo.";
});

$("editSelect").onchange = () => {
  selectedId = Number($("editSelect").value) || null;
  const item = queue.find(post => Number(post.id) === selectedId);
  $("editText").value = item?.post_text || "";
  $("charCount").textContent = $("editText").value.length + " / 280";
  $("previewText").textContent = $("editText").value || "Aquí aparecerá el tweet antes de publicarlo.";
  $("editStatus").textContent = item ? ("ID " + item.id + " · " + item.status) : "Sin selección";
};

$("queueSearch").oninput = () => renderQueue();

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) :
    date.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function statusClass(status) {
  if (status === "published") return "good";
  if (status === "error" || status === "unknown") return "bad";
  if (status === "scheduled" || status === "sending") return "warn";
  return "";
}

function statusLabel(status) {
  return ({
    draft: "Borrador",
    scheduled: "Programado",
    approved: "Aprobado",
    sending: "Enviando",
    published: "Publicado",
    error: "Error",
    unknown: "Estado incierto"
  })[status] || status || "—";
}

async function refreshAll() {
  const status = await api("/api/status");
  settings = status.settings || {};

  $("mPublished").textContent = status.publishedToday ?? 0;
  $("mDailySub").textContent = "Límite: " + settings.maxPostsPerDay + " tweets";
  $("mQueue").textContent = (Number(status.queue?.drafts) || 0) + (Number(status.queue?.scheduled) || 0);
  $("mErrors").textContent = status.totals?.errors ?? 0;
  $("mBudget").textContent = "€" + Number(status.monthlyCostEur || 0).toFixed(2);
  $("mBudgetSub").textContent = "Tope: €" + Number(status.monthlyBudgetEur || 0).toFixed(2);
  $("budgetBar").style.width = Math.min(
    100,
    status.monthlyBudgetEur ? status.monthlyCostEur / status.monthlyBudgetEur * 100 : 0
  ) + "%";

  $("modePill").textContent = status.paused ? "Pausado" : (settings.autoPublish ? "Automático" : "Manual");
  $("pausePill").textContent = status.paused ? "Pausado" : "Activo";
  $("pausePill").className = "pill " + (status.paused ? "bad" : "good");
  $("sideState").textContent = status.paused ? "Automatización pausada" : "Worker conectado";
  $("sideDot").style.background = status.paused ? "#ffc878" : "#68e0aa";

  $("autoPublish").checked = !!settings.autoPublish;
  $("autoPublish2").checked = !!settings.autoPublish;
  $("autoBatch").checked = !!settings.autoBatchEnabled;
  $("autoBatch2").checked = !!settings.autoBatchEnabled;
  $("batchSize").value = String(settings.batchSize || 4);
  $("linksPerBatch").value = String(settings.linksPerBatch ?? 1);
  $("intervalHours").value = String(settings.autoBatchIntervalHours || 3);
  $("maxPostsPerDay").value = String(settings.maxPostsPerDay || 32);
  $("scheduleMetric").textContent = "Cada " + (settings.autoBatchIntervalHours || 3) + " h";
  $("scheduleText").textContent = settings.autoBatchEnabled ?
    "Generación automática activada." : "Generación automática desactivada.";

  fillSettings();
  await Promise.all([loadQueue(), loadHistory(), loadEvents()]);
}

function fillSettings() {
  for (const key of [
    "siteUrl", "rssUrl", "model", "maxArticleAgeHours", "maxPostChars", "timezone",
    "monthlyBudgetEur", "hardStopEur", "normalPostUsd", "urlPostUsd",
    "usdToEurRate", "tweetSpacingSeconds"
  ]) {
    if ($(key) && settings[key] !== undefined) $(key).value = settings[key];
  }
}

async function generate(count) {
  const data = await api("/api/generate", "POST", { count });
  toast("Generados " + data.posts.length + " borradores. Revisa la cola antes de publicar.");
  await loadQueue();
  showView("queue");
}

async function loadQueue() {
  const data = await api("/api/queue");
  queue = data.posts || [];
  renderQueue();
  renderOverviewQueue();

  const select = $("editSelect");
  const old = selectedId;

  select.innerHTML = '<option value="">Selecciona un tweet de la cola</option>' +
    queue.filter(post => ["draft", "scheduled", "approved", "error"].includes(post.status)).map(post =>
      '<option value="' + post.id + '">#' + post.id + " · " +
      escapeHtml(post.article_title || post.post_text || "Tweet") + "</option>"
    ).join("");

  if (old && queue.some(post => Number(post.id) === Number(old))) {
    select.value = String(old);
    $("editSelect").dispatchEvent(new Event("change"));
  } else if (!old && queue.length) {
    const first = queue.find(post => ["draft", "scheduled", "approved", "error"].includes(post.status));
    if (first) {
      select.value = String(first.id);
      select.dispatchEvent(new Event("change"));
    }
  }
}

function renderOverviewQueue() {
  const items = queue.slice(0, 5);

  $("overviewQueue").innerHTML = items.length ? items.map(post =>
    '<div class="item"><div class="itemtop"><div class="itemtitle">#' + post.id + " · " +
    escapeHtml(post.article_title || "Tweet") + '</div><span class="pill ' + statusClass(post.status) + '">' +
    statusLabel(post.status) + "</span></div><div class=\"itembody\">" +
    escapeHtml(post.post_text || "") + '</div><div class="itemmeta">' +
    escapeHtml(formatDate(post.scheduled_at || post.created_at)) +
    '</div><div class="actions" style="margin-top:10px"><button class="btn smallbtn" data-edit="' +
    post.id + '">Editar</button>' +
    (["draft", "scheduled", "approved", "error"].includes(post.status) ?
      '<button class="btn primary smallbtn" data-publish="' + post.id + '">Publicar ahora</button>' : "") +
    "</div></div>"
  ).join("") : '<div class="empty">La cola está vacía. Genera tu primera tanda.</div>';

  bindItemButtons($("overviewQueue"));
}

function renderQueue() {
  const search = ($("queueSearch").value || "").toLowerCase();
  const items = queue.filter(post =>
    (post.post_text + " " + post.article_title + " " + post.status).toLowerCase().includes(search)
  );

  $("queueList").innerHTML = items.length ? items.map(post =>
    '<div class="item"><div class="itemtop"><div class="itemtitle">#' + post.id + " · " +
    escapeHtml(post.article_title || "Tweet manual") + '</div><span class="pill ' + statusClass(post.status) + '">' +
    statusLabel(post.status) + "</span></div><div class=\"itembody\">" +
    escapeHtml(post.post_text || "") + '</div><div class="itemmeta">Creado: ' +
    escapeHtml(formatDate(post.created_at)) +
    (post.scheduled_at ? " · Programado: " + escapeHtml(formatDate(post.scheduled_at)) : "") +
    (post.x_post_id ? " · X ID: " + escapeHtml(post.x_post_id) : "") + "</div>" +
    (post.error ? '<p style="color:var(--red);font-size:12px">' + escapeHtml(post.error) + "</p>" : "") +
    '<div class="actions" style="margin-top:11px"><button class="btn smallbtn" data-edit="' + post.id + '">Editar</button>' +
    (post.status === "scheduled" ? '<button class="btn smallbtn" data-unschedule="' + post.id + '">Cancelar hora</button>' : "") +
    (["draft", "scheduled", "approved", "error"].includes(post.status) ?
      '<button class="btn primary smallbtn" data-publish="' + post.id + '">Publicar ahora</button>' : "") +
    (["draft", "scheduled", "approved", "error"].includes(post.status) ?
      '<button class="btn smallbtn" data-delete="' + post.id + '">Eliminar</button>' : "") +
    "</div></div>"
  ).join("") : '<div class="empty">No hay resultados. Prueba otra búsqueda o genera nuevos borradores.</div>';

  bindItemButtons($("queueList"));
}

function bindItemButtons(root) {
  root.querySelectorAll("[data-edit]").forEach(button => button.onclick = () => {
    selectedId = Number(button.dataset.edit);
    showView("composer");
    $("editSelect").value = String(selectedId);
    $("editSelect").dispatchEvent(new Event("change"));
  });

  root.querySelectorAll("[data-publish]").forEach(button => button.onclick = () => runTask("", async () => {
    const data = await api("/api/posts/publish", "POST", { id: Number(button.dataset.publish) });
    toast("Resultado: " + JSON.stringify(data));
    await refreshAll();
  }));

  root.querySelectorAll("[data-unschedule]").forEach(button => button.onclick = () => runTask("Programación cancelada.", async () => {
    await api("/api/posts/unschedule", "POST", { id: Number(button.dataset.unschedule) });
    await refreshAll();
  }));

  root.querySelectorAll("[data-delete]").forEach(button => button.onclick = () => runTask("Borrador eliminado.", async () => {
    if (!confirm("¿Eliminar este borrador?")) return;
    await api("/api/posts/delete", "POST", { id: Number(button.dataset.delete) });
    await refreshAll();
  }));
}

async function saveSelected() {
  if (!selectedId) throw Error("Selecciona primero un tweet.");
  const text = $("editText").value.trim();
  await api("/api/posts/save", "POST", { id: selectedId, text });
  await loadQueue();
}

async function publishSelected() {
  if (!selectedId) throw Error("Selecciona primero un tweet.");
  if (!confirm("¿Publicar este tweet ahora en X?")) return;
  const data = await api("/api/posts/publish", "POST", { id: selectedId });
  toast("Resultado: " + JSON.stringify(data));
  await refreshAll();
}

async function scheduleSelected() {
  if (!selectedId) throw Error("Selecciona primero un tweet.");
  if (!$("scheduleDate").value) throw Error("Selecciona fecha y hora.");

  await saveSelected();
  const date = new Date($("scheduleDate").value);
  if (Number.isNaN(date.getTime())) throw Error("Fecha no válida.");

  await api("/api/posts/schedule", "POST", {
    id: selectedId,
    scheduledAt: date.toISOString()
  });

  await refreshAll();
}

async function unscheduleSelected() {
  if (!selectedId) throw Error("Selecciona primero un tweet.");
  await api("/api/posts/unschedule", "POST", { id: selectedId });
  await refreshAll();
}

async function loadNews() {
  const data = await api("/api/articles");

  $("newsList").innerHTML = (data.articles || []).length ? data.articles.map(article =>
    '<div class="item"><div class="itemtop"><div class="itemtitle">' +
    escapeHtml(article.title) + '</div><span class="pill">' + Math.round(article.ageHours) +
    ' h</span></div><p class="itembody">' + escapeHtml(article.description || "Sin descripción") +
    '</p><div class="itemmeta">' + escapeHtml(formatDate(article.publishedAt)) +
    '</div><div class="actions" style="margin-top:10px"><a class="btn smallbtn" href="' +
    escapeHtml(article.url) + '" target="_blank" rel="noopener noreferrer">Abrir noticia ↗</a></div></div>'
  ).join("") : '<div class="empty">No hay noticias nuevas en el feed.</div>';
}

async function saveAutomation() {
  await api("/api/settings", "POST", {
    autoBatchEnabled: $("autoBatch2").checked,
    autoPublish: $("autoPublish2").checked,
    batchSize: Number($("batchSize").value),
    linksPerBatch: Number($("linksPerBatch").value),
    autoBatchIntervalHours: Number($("intervalHours").value),
    maxPostsPerDay: Number($("maxPostsPerDay").value)
  });

  await api("/api/settings/resume", "POST", {});
  await refreshAll();
}

async function saveMode() {
  await api("/api/settings", "POST", {
    autoPublish: $("autoPublish").checked,
    autoBatchEnabled: $("autoBatch").checked
  });

  await api("/api/settings/resume", "POST", {});
  await refreshAll();
}

async function saveSettings() {
  const body = {};

  for (const key of ["siteUrl", "rssUrl", "model", "timezone"]) {
    body[key] = $(key).value.trim();
  }

  for (const key of [
    "maxArticleAgeHours", "maxPostChars", "monthlyBudgetEur", "hardStopEur",
    "normalPostUsd", "urlPostUsd", "usdToEurRate", "tweetSpacingSeconds"
  ]) {
    body[key] = Number($(key).value);
  }

  await api("/api/settings", "POST", body);
  await refreshAll();
}

async function pauseAll() {
  await api("/api/settings/pause", "POST", {});
  await refreshAll();
}

async function loadHistory() {
  const data = await api("/api/posts?limit=100");

  $("historyRows").innerHTML = (data.posts || []).map(post =>
    "<tr><td>" + post.id + "</td><td><span class=\"pill " + statusClass(post.status) + "\">" +
    statusLabel(post.status) + "</span></td><td style=\"min-width:230px;max-width:390px;overflow-wrap:anywhere\">" +
    escapeHtml(post.post_text || "") + "</td><td>" +
    escapeHtml(formatDate(post.published_at || post.created_at)) +
    '</td><td style="min-width:180px;color:var(--red);overflow-wrap:anywhere">' +
    escapeHtml(post.error || "—") + "</td></tr>"
  ).join("") || '<tr><td colspan="5">Todavía no hay publicaciones.</td></tr>';
}

async function loadEvents() {
  const data = await api("/api/events");

  $("eventList").innerHTML = (data.events || []).map(event =>
    '<div class="item"><div class="itemtop"><span class="pill ' +
    (event.level === "error" ? "bad" : event.level === "warning" ? "warn" : "") +
    '">' + escapeHtml(event.level) + '</span><span class="itemmeta">' +
    escapeHtml(formatDate(event.created_at)) + '</span></div><div class="itembody">' +
    escapeHtml(event.details || "") + "</div></div>"
  ).join("") || '<div class="empty">No hay eventos registrados.</div>';
}

window.addEventListener("load", () => {
  $("token").value = "";
  $("scheduleDate").min = new Date(Date.now() + 60000).toISOString().slice(0, 16);
});
</script>
</body>
</html>`;
}
