import fs from "fs";
import path from "path";

type Config = {
  port: number;
  dbBackend: "postgres" | "sqlite";
  sqlitePath: string;
  databaseUrl: string;
  databasePoolMax: number;
  databaseConnectionTimeoutMs: number;
  databaseIdleTimeoutMs: number;
  databaseStatementTimeoutMs: number;
  databaseIdleInTransactionTimeoutMs: number;
  tokenAuth: string;
  nodeEnv: string;
  corsOrigin: string;
  siteUrl: string;
  sesRegion: string | null;
  sesAccessKeyId: string | null;
  sesSecretAccessKey: string | null;
  sesFromEmail: string | null;
  sesFromName: string;
  gameDataAdminEmail: string;
  gameDataAdminAccountId: string | null;
  gameDataAdminProxyToken: string | null;
  dataDir: string;
  uploadsDir: string;
};

const projectRoot = path.resolve(__dirname, "..");

function readEnvFile(): void {
  const envPath = path.join(projectRoot, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalNumberEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

readEnvFile();

const dbBackendRaw = (process.env.DB_BACKEND?.trim() || "postgres").toLowerCase();

if (dbBackendRaw !== "postgres" && dbBackendRaw !== "sqlite") {
  throw new Error(
    `Invalid DB_BACKEND value: ${dbBackendRaw}. Expected "postgres" or "sqlite".`,
  );
}

const dbBackend = dbBackendRaw as "postgres" | "sqlite";

// Single data directory for self-contained deployments (Docker all-in-one):
// when set, the SQLite file and the uploads folder live under it by default.
// Explicit SQLITE_PATH / UPLOADS_DIR always win over DATA_DIR.
const dataDir = path.resolve(
  process.env.DATA_DIR?.trim() || path.join(projectRoot, "data"),
);

fs.mkdirSync(dataDir, { recursive: true });

const sqlitePath =
  process.env.SQLITE_PATH?.trim() || path.join(dataDir, "resu.sqlite");

const uploadsDir =
  process.env.UPLOADS_DIR?.trim() || path.join(dataDir, "uploads");

fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const config: Config = {
  port: Number(process.env.PORT ?? 3001),
  dbBackend,
  sqlitePath,
  databaseUrl:
    dbBackend === "sqlite"
      ? (process.env.DATABASE_URL?.trim() ?? "")
      : getRequiredEnv("DATABASE_URL"),
  databasePoolMax: getOptionalNumberEnv("DATABASE_POOL_MAX", 20),
  databaseConnectionTimeoutMs: getOptionalNumberEnv("DATABASE_CONNECTION_TIMEOUT_MS", 5000),
  databaseIdleTimeoutMs: getOptionalNumberEnv("DATABASE_IDLE_TIMEOUT_MS", 30000),
  databaseStatementTimeoutMs: getOptionalNumberEnv("DATABASE_STATEMENT_TIMEOUT_MS", 15000),
  databaseIdleInTransactionTimeoutMs: getOptionalNumberEnv("DATABASE_IDLE_IN_TX_TIMEOUT_MS", 10000),
  tokenAuth: getRequiredEnv("TOKEN_AUTH"),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN?.trim() || "*",
  siteUrl: (process.env.SITE_URL?.trim() || "http://localhost:3001").replace(/\/+$/, ""),
  sesRegion: process.env.SES_REGION?.trim() || null,
  sesAccessKeyId: process.env.SES_ACCESS_KEY_ID?.trim() || null,
  sesSecretAccessKey: process.env.SES_SECRET_ACCESS_KEY?.trim() || null,
  sesFromEmail: process.env.SES_FROM_EMAIL?.trim() || null,
  sesFromName: process.env.SES_FROM_NAME?.trim() || "Resu",
  gameDataAdminEmail: (process.env.GAME_DATA_ADMIN_EMAIL?.trim() || "").toLowerCase(),
  gameDataAdminAccountId: process.env.GAME_DATA_ADMIN_ACCOUNT_ID?.trim() || null,
  gameDataAdminProxyToken: process.env.GAME_DATA_ADMIN_PROXY_TOKEN?.trim() || null,
  dataDir,
  uploadsDir,
};

export default config;
