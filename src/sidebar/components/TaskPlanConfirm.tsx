export interface PlanConfirmData {
    summary: string
    status: 'pending' | 'approved' | 'rejected'
    onProceed: () => void
    onReject: () => void
}

interface TaskPlanConfirmProps {
    plan: PlanConfirmData
}

function TaskPlanConfirm({ plan }: TaskPlanConfirmProps) {
    const isPending = plan.status === 'pending'

    return (
        <div className={`task-plan-confirm ${plan.status}`}>
            <div className="task-plan-confirm-body">
                <span className="task-plan-confirm-icon">
                    {plan.status === 'approved' ? '✅' : plan.status === 'rejected' ? '❌' : '📋'}
                </span>
                <p className="task-plan-confirm-summary">{plan.summary}</p>
            </div>

            {isPending && (
                <div className="task-plan-confirm-actions">
                    <button
                        className="task-plan-btn reject"
                        onClick={plan.onReject}
                    >
                        ✕ Cancel
                    </button>
                    <button
                        className="task-plan-btn proceed"
                        onClick={plan.onProceed}
                    >
                        ▶ Proceed
                    </button>
                </div>
            )}

            {plan.status === 'approved' && (
                <span className="task-plan-status-label approved">Approved</span>
            )}
            {plan.status === 'rejected' && (
                <span className="task-plan-status-label rejected">Cancelled</span>
            )}
        </div>
    )
}

export default TaskPlanConfirm
