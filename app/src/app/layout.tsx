import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LatinSoftGestion", template: "%s · LatinSoftGestion" },
  description: "Gestión comercial, inventario y abastecimiento inteligente",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
