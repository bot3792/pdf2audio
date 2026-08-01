import { Link } from "react-router";

export function Breadcrumbs({ items }: { items: Array<{ to?: string; label: string }> }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-(--text-muted)" data-testid="breadcrumbs">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5 min-w-0">
          {i > 0 && <span className="text-(--text-faint)">›</span>}
          {item.to ? (
            <Link to={item.to} className="text-blue-600 hover:text-blue-800 truncate">
              {item.label}
            </Link>
          ) : (
            <span className="text-(--text-secondary) font-medium truncate">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
