# LatinSoftGestion

Plataforma web de **gestión comercial, inventario y abastecimiento inteligente** para micro y pequeñas empresas.

> Sabe qué tienes, qué estás vendiendo, qué te falta y a quién debes comprárselo.

LatinSoftGestion conecta en un solo flujo lo que normalmente se maneja por separado:

**Cotización → Pedido → Detección de faltantes → Necesidad de compra → Comparación de proveedores → Orden de compra → Recepción → Inventario → Despacho**

## Funcionalidades

- **Dashboard** con KPIs del día, ventas de 30 días, productos más vendidos, inventario crítico y Copiloto IA.
- **Ventas:** cotizaciones con disponibilidad en tiempo real, pedidos con reserva de inventario y despacho parcial, facturas, pagos y cartera de clientes.
- **Inventario:** catálogo con código de barras, existencias por bodega (físico, comprometido, disponible, en tránsito), Kardex trazable, ajustes, transferencias y alertas.
- **Compras:** motor de reposición, comparador de proveedores (precio, entrega, crédito, cumplimiento, cobertura) con compra multiproveedor, órdenes de compra y recepción total o parcial con lote y vencimiento.
- **Finanzas:** caja, cierres, cuentas por cobrar y por pagar, rentabilidad por producto y por venta.
- **Copiloto IA:** consultas en lenguaje natural sobre el negocio; los números siempre los calcula el sistema.
- **Seguridad:** multiempresa, roles y permisos validados en el servidor, y auditoría de acciones críticas.

## Tecnología

Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL · Prisma · Recharts · Claude API (opcional)

## Inicio rápido

Requiere Node.js 20 o superior. Si no tiene PostgreSQL, `npm run db:start` levanta uno local sin instalación
(déjelo corriendo en otra terminal):

```bash
cd app
cp .env.example .env
npm install
npm run db:start
```

En otra terminal:

```bash
cd app
npm run db:deploy
npm run db:seed
npm run build
npm start
```

Abra http://localhost:3000 e ingrese con `admin@latinsoft.co` / `Demo2026!` (datos de demostración).

Para validar el flujo completo de negocio:

```bash
cd app
npm run test:e2e
```

## Despliegue

Producción en Vercel con PostgreSQL en Supabase: ver [Despliegue en Vercel + Supabase](app/README.md#despliegue-en-vercel--supabase).

## Documentación

Instalación detallada, cuentas por rol, reglas de negocio, Copiloto IA y arquitectura: [app/README.md](app/README.md).
