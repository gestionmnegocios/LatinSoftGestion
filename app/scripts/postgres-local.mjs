// Servidor PostgreSQL local para desarrollo, sin instalación ni permisos de administrador.
// Usa los binarios oficiales empaquetados por `embedded-postgres` y guarda los datos en app/.pgdata.
// En producción no se usa: apunte DATABASE_URL a su servidor PostgreSQL.
//
//   npm run db:start   → inicia (y crea la primera vez) el servidor en localhost:5432
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.resolve(here, "..", ".pgdata");
const port = Number(process.env.PG_LOCAL_PORT ?? 5432);
const user = process.env.PG_LOCAL_USER ?? "latinsoft";
const password = process.env.PG_LOCAL_PASSWORD ?? "latinsoft_dev";
const database = process.env.PG_LOCAL_DB ?? "latinsoft";

const pg = new EmbeddedPostgres({
  databaseDir,
  port,
  user,
  password,
  authMethod: "scram-sha-256",
  persistent: true,
  // UTF-8 con collation ICU en español, para ordenar y comparar acentos correctamente.
  initdbFlags: ["--encoding=UTF8", "--locale-provider=icu", "--icu-locale=es-CO", "--locale=C"],
  onLog: () => {},
  onError: (e) => console.error(String(e).trim()),
});

const firstRun = !existsSync(path.join(databaseDir, "PG_VERSION"));
if (firstRun) {
  console.log(`→ Inicializando clúster PostgreSQL en ${databaseDir}…`);
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient();
await client.connect();
const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
if (!rows.length) {
  await client.query(`CREATE DATABASE "${database}"`);
  console.log(`→ Base de datos "${database}" creada.`);
}
const { rows: v } = await client.query("SHOW server_version");
await client.end();

console.log(`✔ PostgreSQL ${v[0].server_version} escuchando en localhost:${port} (base "${database}", usuario "${user}").`);
console.log("  Deje esta ventana abierta; Ctrl+C para detener.");

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  console.log("\n→ Deteniendo PostgreSQL…");
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
