import { useState } from "react";
import type { ActionStep } from "../../shared/messages";
import type { PolicyVerdict } from "../../shared/safety-policy";

interface ConfirmDialogProps {
  step: ActionStep;
  verdict: PolicyVerdict;
  onConfirm: () => void;
  onCancel: () => void;
}

const RISK_COLORS: Record<string, { accent: string; bg: string }> = {
  low: { accent: "#2d7a3a", bg: "#f0faf0" },
  medium: { accent: "#9a6700", bg: "#fef9ec" },
  high: { accent: "#d93025", bg: "#fef2f2" },
};

function ConfirmDialog({
  step,
  verdict,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [confirmed, setConfirmed] = useState(false);
  const riskDisplay = verdict.escalatedRisk || verdict.originalRisk;
  const colors = RISK_COLORS[riskDisplay] || RISK_COLORS.medium;
  const isHighRisk = riskDisplay === "high";

  return (
    <div className="confirm-overlay">
      <div className="confirm-dialog">
        {/* Header */}
        <div
          className="confirm-header"
          style={{ borderBottomColor: colors.accent }}
        >
          <span className="confirm-icon">{isHighRisk ? "⚠️" : "🔒"}</span>
          <span className="confirm-title">
            {isHighRisk ? "High-Risk Action" : "Confirm Action"}
          </span>
        </div>

        {/* Body */}
        <div className="confirm-body">
          <p className="confirm-reason">{verdict.reason}</p>

          <div className="confirm-step-card" style={{ background: colors.bg }}>
            <div className="confirm-step-action">
              <strong>{step.action}</strong> on <code>{step.selector}</code>
            </div>
            {step.description && (
              <p className="confirm-step-desc">{step.description}</p>
            )}
            {step.value && (
              <p className="confirm-step-value">
                Value: <code>{step.value}</code>
              </p>
            )}
          </div>

          {verdict.escalatedRisk && (
            <p className="confirm-escalation">
              ⬆ Risk escalated from <strong>{verdict.originalRisk}</strong> to{" "}
              <strong style={{ color: colors.accent }}>
                {verdict.escalatedRisk}
              </strong>
            </p>
          )}

          {isHighRisk && (
            <label className="confirm-checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="confirm-checkbox"
              />
              I understand the risks and want to proceed
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="confirm-footer">
          <button className="confirm-btn cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="confirm-btn proceed"
            onClick={onConfirm}
            disabled={isHighRisk && !confirmed}
            style={{
              background: isHighRisk ? "#d93025" : colors.accent,
            }}
          >
            {isHighRisk ? "Proceed Anyway" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
