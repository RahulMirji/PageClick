import { useEffect, useRef } from "react";

export interface TaskStep {
  description: string;
  status: "completed" | "running" | "pending" | "failed";
}

export interface TaskProgress {
  explanation: string;
  steps: TaskStep[];
}

interface TaskProgressCardProps {
  progress: TaskProgress;
}

const STATUS_ICONS: Record<TaskStep["status"], string> = {
  completed: "✓",
  running: "",
  pending: "",
  failed: "✕",
};

function TaskProgressCard({ progress }: TaskProgressCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [
    progress.steps.length,
    progress.steps[progress.steps.length - 1]?.status,
  ]);

  const completedCount = progress.steps.filter(
    (s) => s.status === "completed",
  ).length;
  const totalCount = progress.steps.length;
  const progressPercent =
    totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const allDone = totalCount > 0 && completedCount === totalCount;
  const hasFailed = progress.steps.some((s) => s.status === "failed");

  return (
    <div
      className={`task-progress-card ${allDone ? "done" : ""} ${hasFailed ? "has-error" : ""}`}
      ref={cardRef}
    >
      {/* Header */}
      <div className="task-progress-header">
        <span className="task-progress-icon">
          {hasFailed ? "⚠️" : allDone ? "✅" : "⚡"}
        </span>
        <span className="task-progress-title">{progress.explanation}</span>
      </div>

      {/* Timeline */}
      <div className="task-progress-timeline">
        {progress.steps.map((step, i) => (
          <div key={i} className={`task-step task-step-${step.status}`}>
            <div className="task-step-indicator">
              <div className={`task-step-dot ${step.status}`}>
                {step.status === "running" ? (
                  <span className="task-step-spinner" />
                ) : (
                  <span className="task-step-icon-text">
                    {STATUS_ICONS[step.status]}
                  </span>
                )}
              </div>
              {i < progress.steps.length - 1 && (
                <div
                  className={`task-step-line ${
                    step.status === "completed" ? "filled" : ""
                  }`}
                />
              )}
            </div>
            <span className="task-step-label">{step.description}</span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {totalCount > 1 && (
        <div className="task-progress-bar-container">
          <div
            className={`task-progress-bar-fill ${hasFailed ? "error" : ""}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default TaskProgressCard;
