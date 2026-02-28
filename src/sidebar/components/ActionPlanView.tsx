import { useState } from "react";
import type { ActionPlan, ActionStep } from "../../shared/messages";

interface ActionPlanViewProps {
  plan: ActionPlan;
  onApprove: (step: ActionStep) => void;
  onApproveAll: () => void;
  onDismiss: () => void;
}

const RISK_COLORS: Record<
  string,
  { bg: string; text: string; border: string; label: string }
> = {
  low: { bg: "#f0faf0", text: "#2d7a3a", border: "#c3e6c3", label: "Low Risk" },
  medium: {
    bg: "#fef9ec",
    text: "#9a6700",
    border: "#f0d88c",
    label: "Medium Risk",
  },
  high: {
    bg: "#fef2f2",
    text: "#d93025",
    border: "#f5c6c6",
    label: "High Risk",
  },
};

const ACTION_ICONS: Record<string, string> = {
  click: "🖱️",
  input: "⌨️",
  scroll: "📜",
  extract: "📋",
  navigate: "🔗",
};

function ActionPlanView({
  plan,
  onApprove,
  onApproveAll,
  onDismiss,
}: ActionPlanViewProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  const hasHighRisk = plan.actions.some((a) => a.risk === "high");
  const avgConfidence =
    plan.actions.length > 0
      ? plan.actions.reduce((sum, a) => sum + a.confidence, 0) /
        plan.actions.length
      : 0;

  // Highlight element on page when hovering a step
  const handleStepHover = (step: ActionStep | null) => {
    if (step) {
      chrome.runtime.sendMessage({
        type: "HIGHLIGHT_ELEMENT",
        selector: step.selector,
      });
    } else {
      chrome.runtime.sendMessage({ type: "CLEAR_HIGHLIGHT" });
    }
  };

  return (
    <div className="action-plan">
      {/* Header */}
      <div className="action-plan-header">
        <div className="action-plan-header-top">
          <span className="action-plan-icon">⚡</span>
          <span className="action-plan-title">Suggested Actions</span>
          <button
            className="action-plan-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss plan"
          >
            ✕
          </button>
        </div>
        <p className="action-plan-explanation">{plan.explanation}</p>
        <div className="action-plan-meta">
          <span className="action-plan-meta-item">
            {plan.actions.length} step{plan.actions.length !== 1 ? "s" : ""}
          </span>
          <span className="action-plan-meta-sep">·</span>
          <span className="action-plan-meta-item">
            {Math.round(avgConfidence * 100)}% confidence
          </span>
        </div>
      </div>

      {/* Steps */}
      <div className="action-plan-steps">
        {plan.actions.map((step, i) => {
          const risk = RISK_COLORS[step.risk] || RISK_COLORS.low;
          const isExpanded = expandedStep === i;
          const isHovered = hoveredStep === i;

          return (
            <div
              key={i}
              className={`action-step ${isHovered ? "hovered" : ""}`}
              onMouseEnter={() => {
                setHoveredStep(i);
                handleStepHover(step);
              }}
              onMouseLeave={() => {
                setHoveredStep(null);
                handleStepHover(null);
              }}
            >
              <div
                className="action-step-main"
                onClick={() => setExpandedStep(isExpanded ? null : i)}
              >
                <span className="action-step-number">{i + 1}</span>
                <span className="action-step-icon">
                  {ACTION_ICONS[step.action] || "⚙️"}
                </span>
                <div className="action-step-info">
                  <span className="action-step-desc">
                    {step.description || `${step.action} on ${step.selector}`}
                  </span>
                  <div className="action-step-badges">
                    <span
                      className="action-step-risk"
                      style={{
                        background: risk.bg,
                        color: risk.text,
                        borderColor: risk.border,
                      }}
                    >
                      {risk.label}
                    </span>
                    <span className="action-step-confidence">
                      {Math.round(step.confidence * 100)}%
                    </span>
                  </div>
                </div>
                <button
                  className="action-step-run"
                  onClick={(e) => {
                    e.stopPropagation();
                    onApprove(step);
                  }}
                  title="Run this step"
                >
                  ▶
                </button>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="action-step-details">
                  <div className="action-step-detail-row">
                    <span className="detail-label">Action</span>
                    <code>{step.action}</code>
                  </div>
                  <div className="action-step-detail-row">
                    <span className="detail-label">Selector</span>
                    <code className="detail-selector">{step.selector}</code>
                  </div>
                  {step.value && (
                    <div className="action-step-detail-row">
                      <span className="detail-label">Value</span>
                      <code>{step.value}</code>
                    </div>
                  )}
                  {step.expect && (
                    <div className="action-step-detail-row">
                      <span className="detail-label">Expect</span>
                      <code>{JSON.stringify(step.expect)}</code>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions footer */}
      <div className="action-plan-footer">
        <button className="action-plan-btn secondary" onClick={onDismiss}>
          Dismiss
        </button>
        <button
          className={`action-plan-btn primary ${hasHighRisk ? "caution" : ""}`}
          onClick={onApproveAll}
          disabled={hasHighRisk}
          title={
            hasHighRisk
              ? "Cannot auto-run: contains high-risk actions"
              : "Run all steps"
          }
        >
          {hasHighRisk ? "⚠ High Risk" : "▶ Run All"}
        </button>
      </div>
    </div>
  );
}

export default ActionPlanView;
