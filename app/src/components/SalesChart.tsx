"use client";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function SalesChart({ data }: { data: { day: string; ventas: number; cotizaciones: number }[] }) {
  const fmt = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1).replace(".0", "")}M` : `$${Math.round(v / 1000)}k`);
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0866E5" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#0866E5" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#EAECF0" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} interval={4} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} width={48} />
          <Tooltip formatter={(v) => "$" + Math.round(Number(v)).toLocaleString("es-CO")} contentStyle={{ borderRadius: 8, border: "1px solid #EAECF0", fontSize: 12 }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="ventas" name="Ventas" stroke="#0866E5" strokeWidth={2} fill="url(#gv)" />
          <Area type="monotone" dataKey="cotizaciones" name="Cotizaciones" stroke="#1683F8" strokeOpacity={0.55} strokeDasharray="4 3" strokeWidth={1.5} fill="none" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
