export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="px-3 py-1 text-xs font-semibold text-(--text-muted) uppercase tracking-wider">{label}</div>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-6 text-sm text-(--text-muted) text-center">{children}</p>;
}
