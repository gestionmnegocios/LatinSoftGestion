/* Copia todos los datos de otra base hacia la base de DATABASE_URL.
 *
 *   npm run db:import -- --from <origen> [--force]
 *
 *   <origen> puede ser:
 *     - un archivo SQLite de la versión anterior (p. ej. prisma/sqlite-backup.db)
 *     - una URL PostgreSQL (p. ej. la base local, para subirla a Supabase)
 *
 * - Antes de copiar aplica las migraciones pendientes en el destino (prisma migrate deploy).
 * - Convierte tipos según el modelo de Prisma e inserta en orden de llaves foráneas.
 * - Se niega a escribir si el destino ya tiene datos, salvo con --force (vacía las tablas antes).
 * - Verifica que los conteos de origen y destino coincidan.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";

type Model = (typeof Prisma.dmmf.datamodel.models)[number];
type Row = Record<string, unknown>;

const args = process.argv.slice(2);
const force = args.includes("--force");
const fromIdx = args.indexOf("--from");
const from = fromIdx >= 0 ? args[fromIdx + 1] : args.find((a) => !a.startsWith("--"));

// Prisma guarda DateTime como `timestamp without time zone` en UTC; node-pg lo interpretaría como hora local.
pg.types.setTypeParser(1114, (v: string) => new Date(v.replace(" ", "T") + "Z"));

function hostOf(url: string) {
  try { const u = new URL(url); return `${u.hostname}:${u.port || 5432}${u.pathname}`; } catch { return url; }
}

function delegate(model: string) {
  return (prisma as unknown as Record<string, { createMany: (a: { data: unknown[] }) => Promise<{ count: number }>; count: () => Promise<number>; deleteMany: () => Promise<unknown> }>)[
    model[0].toLowerCase() + model.slice(1)
  ];
}

/** Orden topológico: un modelo va después de los modelos a los que apunta con sus FKs. */
function insertionOrder(models: readonly Model[]) {
  const deps = new Map(models.map((m) => [m.name, new Set<string>()]));
  for (const m of models) {
    for (const f of m.fields) {
      if (f.kind === "object" && f.relationFromFields?.length && f.type !== m.name) deps.get(m.name)!.add(f.type);
    }
  }
  const out: string[] = [];
  const visit = (n: string, stack = new Set<string>()) => {
    if (out.includes(n) || stack.has(n)) return;
    stack.add(n);
    for (const d of deps.get(n) ?? []) visit(d, stack);
    out.push(n);
  };
  for (const m of models) visit(m.name);
  return out.map((n) => models.find((m) => m.name === n)!);
}

function convert(field: Model["fields"][number], v: unknown) {
  if (v === null || v === undefined) return null;
  switch (field.type) {
    case "DateTime": return v instanceof Date ? v : typeof v === "number" || typeof v === "bigint" ? new Date(Number(v)) : new Date(String(v));
    case "Boolean": return v === true || v === 1 || v === 1n || v === "1" || v === "true";
    case "Int": return Number(v);
    case "Float": return Number(v);
    case "Decimal": return new Prisma.Decimal(String(v));
    default: return typeof v === "bigint" ? Number(v) : v;
  }
}

/** Filas con FK a la misma tabla (p. ej. Category.parentId): primero las que no dependen de otra. */
function sortSelfReferences(model: Model, rows: Row[]) {
  const self = model.fields.find((f) => f.kind === "object" && f.type === model.name && f.relationFromFields?.length);
  if (!self) return rows;
  const fk = self.relationFromFields![0];
  const done = new Set<unknown>();
  const out: Row[] = [];
  let pending = rows;
  while (pending.length) {
    const ready = pending.filter((r) => r[fk] == null || done.has(r[fk]));
    if (!ready.length) throw new Error(`Referencia circular en ${model.name}.${fk}`);
    for (const r of ready) { out.push(r); done.add(r.id); }
    pending = pending.filter((r) => !ready.includes(r));
  }
  return out;
}

type Source = { label: string; tables: Set<string>; read: (table: string) => Promise<Row[]>; close: () => Promise<void> };

async function openSource(spec: string): Promise<Source> {
  if (/^postgres(ql)?:\/\//.test(spec)) {
    const client = new pg.Client({ connectionString: spec });
    await client.connect();
    const { rows } = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    return {
      label: `PostgreSQL ${hostOf(spec)}`,
      tables: new Set(rows.map((r) => r.table_name)),
      read: async (t) => (await client.query(`SELECT * FROM "${t}"`)).rows,
      close: () => client.end(),
    };
  }
  if (!existsSync(spec)) throw new Error(`No existe el archivo SQLite: ${spec}`);
  const db = new DatabaseSync(spec, { readOnly: true });
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
  return {
    label: `SQLite ${spec}`,
    tables,
    read: async (t) => db.prepare(`SELECT * FROM "${t}"`).all() as Row[],
    close: async () => db.close(),
  };
}

async function main() {
  if (!from) throw new Error("Indique el origen: npm run db:import -- --from <archivo.db | postgresql://…>");
  const target = process.env.DATABASE_URL ?? "";
  if (from === target || (/^postgres/.test(from) && hostOf(from) === hostOf(target))) {
    throw new Error("El origen y el destino son la misma base de datos.");
  }

  console.log(`→ Destino: ${hostOf(process.env.DIRECT_URL || target)} — aplicando migraciones…`);
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const source = await openSource(from);
  const models = insertionOrder(Prisma.dmmf.datamodel.models);
  const existing = (await Promise.all(models.map((m) => delegate(m.name).count()))).reduce((a, b) => a + b, 0);
  if (existing > 0 && !force) {
    await source.close();
    throw new Error(`El destino ya tiene ${existing} filas. Use --force para vaciar sus tablas y copiar de nuevo.`);
  }
  if (existing > 0) {
    console.log("→ Vaciando tablas del destino (--force)…");
    for (const m of [...models].reverse()) await delegate(m.name).deleteMany();
  }

  console.log(`→ Copiando desde ${source.label}`);
  const report: { model: string; source: number; target: number }[] = [];
  for (const m of models) {
    if (!source.tables.has(m.name)) { report.push({ model: m.name, source: 0, target: 0 }); continue; }
    const scalar = m.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
    const raw = await source.read(m.name);
    const rows = sortSelfReferences(m, raw.map((r) => Object.fromEntries(scalar.filter((f) => f.name in r).map((f) => [f.name, convert(f, r[f.name])]))));
    for (let i = 0; i < rows.length; i += 1000) await delegate(m.name).createMany({ data: rows.slice(i, i + 1000) });
    const count = await delegate(m.name).count();
    report.push({ model: m.name, source: raw.length, target: count });
    if (raw.length) console.log(`  ${m.name.padEnd(26)} ${String(raw.length).padStart(6)} → ${count}`);
  }
  await source.close();

  const bad = report.filter((r) => r.source !== r.target);
  if (bad.length) throw new Error(`Conteos distintos: ${bad.map((b) => `${b.model} ${b.source}≠${b.target}`).join(", ")}`);
  console.log(`✔ Copia completa: ${report.reduce((a, r) => a + r.target, 0)} filas en ${report.filter((r) => r.source).length} tablas.`);
}

main()
  .catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
