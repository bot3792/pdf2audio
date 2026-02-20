type PipelineStepsProps = {
  status: string;
  chaptersCompleted: number;
  totalChapters: number;
};

const STEPS = ["extracting", "normalizing", "synthesizing", "assembling", "done"] as const;

const STEP_LABELS: Record<string, string> = {
  extracting: "Extract",
  normalizing: "Normalize",
  synthesizing: "Synthesize",
  assembling: "Assemble",
  done: "Done",
};

function getActiveStepIndex(status: string): number {
  if (status === "suspended") return STEPS.indexOf("synthesizing");
  const idx = STEPS.indexOf(status as (typeof STEPS)[number]);
  if (status === "done") return STEPS.length - 1;
  if (status === "failed") return -1;
  if (status === "pending") return -1;
  return idx;
}

function isStepCompleted(stepIndex: number, activeIndex: number, status: string): boolean {
  if (status === "done") return true;
  if (status === "failed") return false;
  return stepIndex < activeIndex;
}

export function PipelineSteps({ status, chaptersCompleted, totalChapters }: PipelineStepsProps) {
  const activeIndex = getActiveStepIndex(status);

  if (status === "pending") {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <span className="inline-block h-2 w-2 rounded-full bg-zinc-300 animate-pulse" />
        Waiting to start...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => {
        const completed = isStepCompleted(i, activeIndex, status);
        const active = i === activeIndex && status !== "done" && status !== "failed";
        const upcoming = !completed && !active;
        const failed = status === "failed" && i === activeIndex;
        const suspended = status === "suspended" && step === "synthesizing";

        let detail = "";
        if (step === "synthesizing" && (active || completed || suspended) && totalChapters > 0) {
          detail = ` ${chaptersCompleted}/${totalChapters}`;
        }

        return (
          <div key={step} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`h-px w-4 ${completed ? "bg-green-400" : active ? "bg-blue-300" : suspended ? "bg-amber-300" : "bg-zinc-200"}`}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`
                  h-2 w-2 rounded-full shrink-0
                  ${completed ? "bg-green-500" : ""}
                  ${active ? "bg-blue-500 animate-pulse" : ""}
                  ${failed ? "bg-red-500" : ""}
                  ${suspended ? "bg-amber-500" : ""}
                  ${upcoming && !suspended ? "bg-zinc-200" : ""}
                `}
              />
              <span
                className={`text-xs whitespace-nowrap ${
                  completed
                    ? "text-green-700 font-medium"
                    : active
                      ? "text-blue-700 font-medium"
                      : failed
                        ? "text-red-700 font-medium"
                        : suspended
                          ? "text-amber-700 font-medium"
                          : "text-zinc-400"
                }`}
              >
                {STEP_LABELS[step]}
                {detail}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
