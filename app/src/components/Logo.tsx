export function Logo({ dark = false, size = 20 }: { dark?: boolean; size?: number }) {
  return (
    <span className="font-bold tracking-tight" style={{ fontSize: size }}>
      <span className={dark ? "text-navy-900" : "text-white"}>LatinSoft</span>
      <span className="text-accent-600">Gestion</span>
    </span>
  );
}
