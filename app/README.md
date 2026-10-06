# LatinSoftGestion — MVP

Plataforma web de gestión comercial, inventario y abastecimiento inteligente, construida a partir del PRD
(documento interno de producto) y el mockup de pantallas.

> **Qué tengo → Qué puedo vender → Qué necesito comprar → A quién conviene comprárselo.**

## Arranque rápido

Requisitos: Node.js 20+ (probado con Node 24) y PostgreSQL 14+.

**1. Base de datos.** Si no tiene un servidor PostgreSQL, levante uno local (sin instalación ni permisos de
administrador; los datos quedan en `app/.pgdata`). Déjelo corriendo en su propia terminal:

```bash
cd app
npm install
npm run db:start
```

Si ya tiene PostgreSQL (local o en la nube), ajuste `DATABASE_URL` en `.env` y omita `db:start`.

**2. Aplicación**, en otra terminal:

```bash
cd app
cp .env.example .env
npm run db:deploy     # aplica las migraciones (prisma/migrations)
npm run db:seed       # carga datos demo (90 días de historia); BORRA los datos existentes
npm run build
npm start             # http://localhost:3000
```

Para desarrollo con recarga en caliente: `npm run dev` (consume bastante más memoria que `npm start`).

### Scripts de base de datos

| Script | Uso |
|---|---|
| `npm run db:start` | Servidor PostgreSQL local de desarrollo en `localhost:5432` |
| `npm run db:deploy` | Aplica migraciones pendientes (también en producción) |
| `npm run db:migrate -- --name <cambio>` | Crea una migración nueva tras editar `prisma/schema.prisma` |
| `npm run db:seed` | Reemplaza todo con los datos demo |
| `npm run db:reset` | Borra la base, reaplica migraciones y carga el demo |
| `npm run db:import-sqlite -- <archivo.db>` | Copia los datos de una base SQLite de la versión anterior |

### Cuentas demo (contraseña `Demo2026!`)

| Usuario | Rol |
|---|---|
| admin@latinsoft.co | Administrador (todo) |
| ventas@latinsoft.co | Vendedor |
| bodega@latinsoft.co | Encargado de bodega |
| compras@latinsoft.co | Comprador |
| caja@latinsoft.co | Caja |

## Pruebas

```bash
npm run test:e2e
```

Ejecuta el **flujo end-to-end obligatorio del PRD (§41 / Arquitectura §45)** contra los servicios reales, en una
organización aislada que se elimina al final: crear producto → entrada inicial 10 → cliente → cotizar 20 →
convertir en pedido (reserva 10, faltante 10) → motor de reposición → necesidad → comparador → OC → confirmar
(en tránsito 10) → recepción parcial 6 + 4 (reserva automática al pedido) → stock 20 → despachar 20 → stock 0 →
factura y pago. Verifica además costo promedio ponderado, CxP, rollback de transacciones, aislamiento
multi-tenant, RBAC en backend, auditoría y continuidad del Kardex (25 verificaciones).

## Módulos

| Módulo | Ruta | Incluye |
|---|---|---|
| Dashboard | `/dashboard` | 8 KPIs, Copiloto IA, gráfico de ventas 30 días, más vendidos, inventario crítico, pedidos pendientes, compras por recibir |
| Ventas | `/ventas/*` | Cotizaciones con disponibilidad en tiempo real y faltantes; pedidos (reserva, preparación, despacho parcial/total, entrega, cancelación); facturas, pagos y cartera; clientes con cupo y plazo |
| Inventario | `/inventario/*` | Productos (CRUD, lector de código de barras, importar/exportar CSV), existencias por bodega (físico, comprometido, disponible, en tránsito, proyectado), Kardex, ajustes, transferencias, alertas |
| Compras | `/compras/*` | Necesidades (motor de reposición editable), comparador de proveedores con puntaje y compra multiproveedor, órdenes de compra con flujo de estados, recepción total/parcial con lote, vencimiento y rechazos |
| Proveedores | `/proveedores` | Condiciones, catálogo N:M producto↔proveedor, cumplimiento, cuentas por pagar |
| Caja y Finanzas | `/finanzas` | Caja (ingresos, egresos, cierres), CxC por vencimiento, CxP, rentabilidad por producto y por venta |
| Reportes | `/reportes` | KPIs operativos y comerciales del PRD §40, ventas por categoría y mes, clasificación ABC |
| Inteligencia IA | `/ia` | Copiloto "Pregúntale a LatinSoft" con herramientas controladas y auditoría de acciones |
| Configuración | `/configuracion` | Empresa, bodegas, usuarios, matriz de roles/permisos, log de auditoría |
| API REST | `/api/products`, `/api/inventory`, `/api/health` | Autenticada por sesión y permisos; no existe endpoint para editar cantidades |

## Reglas de negocio clave (implementadas en `src/server/services`)

- **El inventario no se edita: es el resultado de movimientos.** Todo cambio pasa por `applyMovement()`, que
  registra cantidad anterior, movimiento, resultante, costo, documento y usuario. Los ajustes registran la diferencia.
- **Disponible = Físico − Comprometido**; **Proyectado = Disponible + En tránsito**. Una cotización no reserva;
  el pedido sí. El despacho descuenta el físico y libera la reserva.
- **Faltantes → abastecimiento:** lo no reservado alimenta el motor de reposición:
  `necesidad = demanda prevista + stock de seguridad + faltantes de pedidos − disponible − en tránsito`,
  con piso en el stock mínimo y redondeo a la cantidad mínima del proveedor.
- **Comparador:** puntaje ponderado (precio 40%, entrega 25%, cumplimiento 15%, crédito 10%, disponibilidad 10%),
  no asume que el más barato es el mejor, compara precios solo sobre la canasta común y propone compra
  multiproveedor cuando cubre lo que nadie cubre solo o ahorra dinero incluso pagando más transportes.
- **Recepción atómica:** una transacción crea la recepción, mueve el Kardex, actualiza existencias e incoming,
  recalcula el costo promedio ponderado, actualiza la OC, genera la CxP y **reserva automáticamente** para
  pedidos con faltante, notificando cuando quedan listos para despacho.
- **Getter único de estado de stock** (`getStockStatus`) usado por dashboard, cotización, productos y compras.
- **Multi-tenant:** todas las entidades llevan `organizationId` y todas las consultas filtran por él.
- **RBAC en backend:** cada servicio exige el permiso granular (`inventory.adjust`, `purchase.approve`, …); las
  páginas exigen acceso al módulo; los menús solo reflejan lo anterior.
- **Auditoría:** acciones críticas (inventario, precios, compras, pagos, usuarios) quedan en `AuditLog`.

## Copiloto IA

La base de datos y las reglas de negocio calculan los números; la IA interpreta, explica y propone (PRD §20).
El copiloto usa herramientas controladas (`src/server/ai/tools.ts`): nivel 1 consultas, nivel 2 borradores
(cotización, necesidad de compra). Las acciones críticas siempre requieren confirmación humana en pantalla.
Cada llamada queda en `AIAction`.

- **Sin configuración** funciona con un motor local determinístico en español (intenciones frecuentes del PRD).
- **Con Claude:** defina `ANTHROPIC_API_KEY` en `app/.env` y Claude (`claude-opus-5-5`) interpretará preguntas
  libres usando las mismas herramientas. Si la API falla, responde el motor local. `COPILOT_MODE=local` lo fuerza.

## Arquitectura y decisiones del MVP

- **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4**, con server actions y una capa de servicios de
  dominio separada (`src/server/services`), lista para extraerse a un backend NestJS como plantea el PRD.
- **PostgreSQL + Prisma** con migraciones versionadas en `prisma/migrations`. La base local usa codificación
  UTF-8 y collation ICU `es-CO`; las búsquedas de texto no distinguen mayúsculas (`ILIKE`). Los montos se guardan
  como `double precision`, redondeados a 2 decimales por la capa de servicios.
- Pendiente de fases posteriores del PRD: Redis/BullMQ, almacenamiento S3, envío real de OC por email/WhatsApp
  (hoy "Enviar al proveedor" cambia el estado y deja trazabilidad), facturación electrónica, portal de proveedor,
  multiempresa con varias compañías por organización en la UI, importación Excel (hoy CSV).
