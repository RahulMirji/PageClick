export interface ResumeTaskData {
  summary: string;
  status: "pending" | "resumed";
  onResume: () => void;
}

interface TaskResumeCardProps {
  resume: ResumeTaskData;
}

function TaskResumeCard({ resume }: TaskResumeCardProps) {
  return (
    <div className={`task-resume-card ${resume.status}`}>
      <div className="task-resume-body">
        <span className="task-resume-icon">
          {resume.status === "resumed" ? "✅" : "⏱️"}
        </span>
        <p className="task-resume-summary">{resume.summary}</p>
      </div>

      {resume.status === "pending" ? (
        <div className="task-resume-actions">
          <button className="task-resume-btn" onClick={resume.onResume}>
            ▶ Resume
          </button>
        </div>
      ) : (
        <span className="task-resume-status-label">Resumed</span>
      )}
    </div>
  );
}

export default TaskResumeCard;
