/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  accessCookieName,
  createAccessSessionToken,
  defaultLocalPassword,
} from "../lib/access-token";
import {
  createEmptyLedger,
  createLedgerDocument,
  type LedgerDocument,
  normalizeAccount,
  normalizeLedgerDocument,
  normalizeRecords,
} from "../lib/ledger";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  APP_ACCESS_PASSWORD?: string;
  APP_ACCESS_SESSION_SECRET?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type SavePayload = {
  account?: unknown;
  records?: unknown;
};

type LedgerRow = {
  account: string | null;
  records: string | null;
  updated_at: string | null;
};

const sessionMaxAge = 60 * 60 * 24 * 30;
const ledgerId = "default";
let ledgerTableReady: Promise<void> | null = null;

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/access") {
      return handleAccess(request, env);
    }

    if (url.pathname === "/api/records") {
      return handleRecords(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

async function handleAccess(request: Request, env: Env) {
  if (request.method === "GET") {
    return json({ authenticated: await hasValidAccessCookie(request, env) });
  }

  if (request.method === "POST") {
    const payload = (await request.json().catch(() => ({}))) as {
      password?: unknown;
    };
    const password = typeof payload.password === "string" ? payload.password : "";

    if (password !== getAccessPassword(env)) {
      return json({ authenticated: false, error: "密码不正确" }, 401);
    }

    const response = json({ authenticated: true });
    response.headers.append(
      "set-cookie",
      buildAccessCookie(await createSessionToken(env), request),
    );

    return response;
  }

  if (request.method === "DELETE") {
    const response = json({ authenticated: false });
    response.headers.append(
      "set-cookie",
      `${accessCookieName}=; HttpOnly; Max-Age=0; Path=/; SameSite=Strict`,
    );

    return response;
  }

  return json({ error: "method not allowed" }, 405);
}

async function handleRecords(request: Request, env: Env) {
  if (!(await hasValidAccessCookie(request, env))) {
    return unauthorized();
  }

  if (!env.DB) {
    return json(
      { error: "服务端数据库未配置，请重新部署并启用 D1 数据库" },
      500,
    );
  }

  if (request.method === "GET") {
    return json(await readLedgerFromD1(env.DB));
  }

  if (request.method === "PUT") {
    const payload = (await request.json().catch(() => ({}))) as SavePayload;

    if (!Array.isArray(payload.records)) {
      return json({ error: "records must be an array" }, 400);
    }

    const records = normalizeRecords(payload.records);
    const previous = await readLedgerFromD1(env.DB);
    const nextAccount = Object.hasOwn(payload, "account")
      ? normalizeAccount(payload.account)
      : previous.account;
    const document = createLedgerDocument(nextAccount, records);

    await writeLedgerToD1(env.DB, document);

    return json(document);
  }

  return json({ error: "method not allowed" }, 405);
}

async function readLedgerFromD1(db: D1Database): Promise<LedgerDocument> {
  await ensureLedgerTable(db);

  const row = await db
    .prepare(
      "SELECT account, records, updated_at FROM ledger_documents WHERE id = ?",
    )
    .bind(ledgerId)
    .first<LedgerRow>();

  if (!row) {
    return createEmptyLedger();
  }

  return normalizeLedgerDocument({
    updatedAt: row.updated_at || "",
    account: parseStoredJson(row.account, null),
    records: parseStoredJson(row.records, []),
  });
}

async function writeLedgerToD1(db: D1Database, document: LedgerDocument) {
  await ensureLedgerTable(db);

  await db
    .prepare(
      `INSERT INTO ledger_documents (id, account, records, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         account = excluded.account,
         records = excluded.records,
         updated_at = excluded.updated_at`,
    )
    .bind(
      ledgerId,
      document.account ? JSON.stringify(document.account) : null,
      JSON.stringify(document.records),
      document.updatedAt,
    )
    .run();
}

async function ensureLedgerTable(db: D1Database) {
  ledgerTableReady ??= db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ledger_documents (
        id TEXT PRIMARY KEY NOT NULL,
        account TEXT,
        records TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      )`,
    )
    .run()
    .then(() => undefined);

  return ledgerTableReady;
}

function parseStoredJson(value: string | null, fallback: unknown) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

async function hasValidAccessCookie(request: Request, env: Env) {
  return getCookie(request, accessCookieName) === (await createSessionToken(env));
}

async function createSessionToken(env: Env) {
  return createAccessSessionToken(getAccessPassword(env), getSessionSecret(env));
}

function getAccessPassword(env: Env) {
  return env.APP_ACCESS_PASSWORD || defaultLocalPassword;
}

function getSessionSecret(env: Env) {
  return env.APP_ACCESS_SESSION_SECRET || getAccessPassword(env);
}

function getCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";

  for (const item of header.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=");
    if (rawName === name) {
      return rawValue.join("=");
    }
  }

  return "";
}

function buildAccessCookie(token: string, request: Request) {
  const attributes = [
    `${accessCookieName}=${token}`,
    "HttpOnly",
    `Max-Age=${sessionMaxAge}`,
    "Path=/",
    "SameSite=Strict",
  ];

  if (new URL(request.url).protocol === "https:") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

function unauthorized() {
  return json({ error: "unauthorized" }, 401);
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
