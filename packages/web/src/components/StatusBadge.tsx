type StatusBadgeProps = {
  status: string;
  error?: string | null;
  chaptersCompleted?: number;
  totalChapters?: number;
};

const statusStyles: Record<string, string> = {
  pending: "bg-zinc-100 text-zinc-700",
  extracting: "bg-yellow-100 text-yellow-800",
  synthesizing: "bg-blue-100 text-blue-800",
  normalizing: "bg-purple-100 text-purple-800",
  assembling: "bg-indigo-100 text-indigo-800",
  done: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  suspended: "bg-amber-100 text-amber-800",
  cancelled: "bg-zinc-200 text-zinc-600",
};

export function StatusBadge({ status, error, chaptersCompleted, totalChapters }: StatusBadgeProps) {
  const isCancelled = status === "failed" && error?.startsWith("Cancelled");
  const displayStatus = isCancelled ? "cancelled" : status;
  const style = statusStyles[displayStatus] ?? statusStyles.pending;

  let label = displayStatus;
  if (displayStatus === "synthesizing" && totalChapters && totalChapters > 0) {
    label = `synthesizing ${chaptersCompleted ?? 0}/${totalChapters}`;
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
