/* Copia todos los datos de la base SQLite anterior a PostgreSQL (DATABASE_URL).
 *
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts [ruta.db] [--force]
 *
 * - Lee el archivo SQLite con node:sqlite (solo lectura) y usa el modelo de Prisma para
 *   convertir tipos: fechas (ms → DateTime), booleanos (0/1 → boolean), números.
 * - Inserta en orden de dependencias (llaves foráneas) y verifica los conteos al final.
 * - Se niega a escribir si PostgreSQL ya tiene datos, salvo con --force (vacía las tablas antes).
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";

type Model = (typeof Prisma.dmmf.datamodel.models)[number];

const args = process.argv.slice(2);
const force = args.includes("--force");
const file = args.find((a) => !a.startsWith("--")) ?? "prisma/sqlite-backup.db";

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
    case "DateTime": return typeof v === "number" || typeof v === "bigint" ? new Date(Number(v)) : new Date(String(v));
    case "Boolean": return v === true || v === 1 || v === 1n || v === "1" || v === "true";
    case "Int": return Number(v);
    case "Float": return Number(v);
    case "Decimal": return new Prisma.Decimal(String(v));
    default: return typeof v === "bigint" ? Number(v) : v;
  }
}

/** Filas con FK a la misma tabla (p. ej. Category.parentId): primero las que no dependen de otra. */
function sortSelfReferences(model: Model, rows: Record<string, unknown>[]) {
  const self = model.fields.find((f) => f.kind === "object" && f.type === model.name && f.relationFromFields?.length);
  if (!self) return rows;
  const fk = self.relationFromFields![0];
  const done = new Set<unknown>();
  const out: Record<string, unknown>[] = [];
  let pending = rows;
  while (pending.length) {
    const ready = pending.filter((r) => r[fk] == null || done.has(r[fk]));
    if (!ready.length) throw new Error(`Referencia circular en ${model.name}.${fk}`);
    for (const r of ready) { out.push(r); done.add(r.id); }
    pending = pending.filter((r) => !ready.includes(r));
  }
  return out;
}

async function main() {
  if (!existsSync(file)) throw new Error(`No existe el archivo SQLite: ${file}`);
  const sqlite = new DatabaseSync(file, { readOnly: true });
  const tables = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
  const models = insertionOrder(Prisma.dmmf.datamodel.models);

  const existing = (await Promise.all(models.map((m) => delegate(m.name).count()))).reduce((a, b) => a + b, 0);
  if (existing > 0 && !force) {
    throw new Error(`PostgreSQL ya tiene ${existing} filas. Use --force para vaciar las tablas y migrar de nuevo.`);
  }
  if (existing > 0) {
    console.log("→ Vaciando tablas de PostgreSQL (--force)…");
    for (const m of [...models].reverse()) await delegate(m.name).deleteMany();
  }

  console.log(`→ Migrando ${file} → PostgreSQL`);
  const report: { model: string; source: number; target: number }[] = [];
  for (const m of models) {
    if (!tables.has(m.name)) { report.push({ model: m.name, source: 0, target: 0 }); continue; }
    const scalar = m.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
    const raw = sqlite.prepare(`SELECT * FROM "${m.name}"`).all() as Record<string, unknown>[];
    const rows = sortSelfReferences(m, raw.map((r) => Object.fromEntries(scalar.filter((f) => f.name in r).map((f) => [f.name, convert(f, r[f.name])]))));
    for (let i = 0; i < rows.length; i += 1000) await delegate(m.name).createMany({ data: rows.slice(i, i + 1000) });
    const target = await delegate(m.name).count();
    report.push({ model: m.name, source: raw.length, target });
    if (raw.length) console.log(`  ${m.name.padEnd(26)} ${String(raw.length).padStart(6)} → ${target}`);
  }
  sqlite.close();

  const bad = report.filter((r) => r.source !== r.target);
  if (bad.length) throw new Error(`Conteos distintos: ${bad.map((b) => `${b.model} ${b.source}≠${b.target}`).join(", ")}`);
  console.log(`✔ Migración completa: ${report.reduce((a, r) => a + r.target, 0)} filas en ${report.filter((r) => r.source).length} tablas.`);
}

main()
  .catch((e) => { console.error("❌", e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
