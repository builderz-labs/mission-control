'use client'

export interface DeployAssessment {
  verdict: 'profitable' | 'marginal' | 'losing'
  strategy_info: {
    agent_name: string
    strategy: string
    exchange: string
    symbol: string
    position_size_usd: number
  }
  cost_breakdown: {
    entry_fee: number
    exit_fee: number
    slippage: number
    funding: number
    total_cost: number
    total_cost_pct: number
  }
  expected_return_usd: number
  net_return_usd: number
  net_return_pct: number
  risk_checks: {
    within_position_limit: boolean
    within_exposure_limit: boolean
    kill_switch_ok: boolean
  }
}

interface DeployGateProps {
  isOpen: boolean
  onClose: () => void
  onDeploy: () => void
  assessment: DeployAssessment | null
  isLoading?: boolean
}

const VERDICT_COLOR: Record<DeployAssessment['verdict'], string> = {
  profitable: '#22c55e',
  marginal: '#f59e0b',
  losing: '#ef4444',
}

const VERDICT_BG: Record<DeployAssessment['verdict'], string> = {
  profitable: 'rgba(34,197,94,0.10)',
  marginal: 'rgba(245,158,11,0.10)',
  losing: 'rgba(239,68,68,0.10)',
}

function formatUsd(value: number): string {
  return `$${Math.abs(value).toFixed(2)}`
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`
}

function CostRow({
  label,
  value,
  isBold,
}: {
  label: string
  value: string
  isBold?: boolean
}) {
  return (
    <div className="flex justify-between py-0.5">
      <span
        className="text-xs"
        style={{ color: 'var(--text-muted)', fontWeight: isBold ? 500 : 400 }}
      >
        {label}
      </span>
      <span
        className="text-xs font-mono"
        style={{ color: 'var(--text-secondary)', fontWeight: isBold ? 500 : 400 }}
      >
        {value}
      </span>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
        {value}
      </span>
    </div>
  )
}

function RiskDot({ pass, label }: { pass: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: 9999,
          backgroundColor: pass ? '#22c55e' : '#ef4444',
          flexShrink: 0,
        }}
      />
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
    </div>
  )
}

export function DeployGate({
  isOpen,
  onClose,
  onDeploy,
  assessment,
  isLoading = false,
}: DeployGateProps) {
  if (!isOpen) return null

  const verdictColor = assessment ? VERDICT_COLOR[assessment.verdict] : '#71717a'
  const verdictBg = assessment ? VERDICT_BG[assessment.verdict] : 'transparent'

  const allRiskChecksPass = assessment
    ? assessment.risk_checks.within_position_limit &&
      assessment.risk_checks.within_exposure_limit &&
      assessment.risk_checks.kill_switch_ok
    : true

  const deployLabel =
    assessment?.verdict === 'losing' ? 'Deploy Anyway' : 'Deploy'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.60)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Deploy Gate"
    >
      <div
        className="w-full p-6"
        style={{
          maxWidth: 520,
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <span
              className="text-sm animate-pulse"
              style={{ color: 'var(--text-muted)' }}
            >
              Assessing deployment...
            </span>
          </div>
        )}

        {/* Content */}
        {!isLoading && assessment && (
          <>
            {/* Section 1: Strategy Info */}
            <div className="mb-4">
              <div
                className="text-sm font-medium mb-3"
                style={{ color: 'var(--text-primary)' }}
              >
                Deploy Gate
              </div>
              <InfoRow label="Agent" value={assessment.strategy_info.agent_name} />
              <InfoRow label="Strategy" value={assessment.strategy_info.strategy} />
              <InfoRow label="Exchange" value={assessment.strategy_info.exchange} />
              <InfoRow label="Symbol" value={assessment.strategy_info.symbol} />
              <InfoRow
                label="Position Size"
                value={`$${assessment.strategy_info.position_size_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              />
            </div>

            {/* Section 2: Cost Breakdown */}
            <div
              className="pt-4 mb-4"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <div
                className="text-xs mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Transaction Costs
              </div>
              <CostRow label="Entry Fee" value={formatUsd(assessment.cost_breakdown.entry_fee)} />
              <CostRow label="Exit Fee" value={formatUsd(assessment.cost_breakdown.exit_fee)} />
              <CostRow label="Slippage" value={formatUsd(assessment.cost_breakdown.slippage)} />
              <CostRow label="Funding" value={formatUsd(assessment.cost_breakdown.funding)} />
              <CostRow
                label="Total"
                value={`${formatUsd(assessment.cost_breakdown.total_cost)} (${assessment.cost_breakdown.total_cost_pct.toFixed(2)}%)`}
                isBold
              />
            </div>

            {/* Section 3: Verdict Bar */}
            <div
              className="pt-4 mb-4"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <div
                className="rounded px-3 py-3"
                style={{ backgroundColor: verdictBg, borderRadius: 6 }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="text-xs font-medium"
                    style={{ color: verdictColor, textTransform: 'capitalize' }}
                  >
                    {assessment.verdict}
                  </span>
                  <div className="flex items-center gap-3">
                    <span
                      className="text-xs font-mono"
                      style={{
                        color:
                          assessment.net_return_usd >= 0 ? '#22c55e' : '#ef4444',
                      }}
                    >
                      {assessment.net_return_usd >= 0 ? '+' : '-'}
                      {formatUsd(assessment.net_return_usd)}
                    </span>
                    <span
                      className="text-xs font-mono"
                      style={{
                        color:
                          assessment.net_return_pct >= 0 ? '#22c55e' : '#ef4444',
                      }}
                    >
                      {formatPct(assessment.net_return_pct)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <RiskDot
                    pass={assessment.risk_checks.within_position_limit}
                    label="Position limit"
                  />
                  <RiskDot
                    pass={assessment.risk_checks.within_exposure_limit}
                    label="Exposure limit"
                  />
                  <RiskDot
                    pass={assessment.risk_checks.kill_switch_ok}
                    label="Kill switch"
                  />
                </div>
              </div>
            </div>

            {/* Action bar */}
            <div>
              {!allRiskChecksPass && (
                <div
                  className="text-xs mb-2"
                  style={{ color: '#f59e0b' }}
                >
                  One or more risk checks failed. Review before deploying.
                </div>
              )}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="text-sm px-3 py-1.5"
                  style={{
                    color: 'var(--text-muted)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.color =
                      'var(--text-secondary)'
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.color =
                      'var(--text-muted)'
                  }}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="text-sm px-4 py-2 font-medium"
                  style={{
                    backgroundColor:
                      assessment.verdict === 'losing'
                        ? 'rgba(239,68,68,0.70)'
                        : verdictColor,
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                  onClick={onDeploy}
                >
                  {deployLabel}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Empty / null assessment while not loading */}
        {!isLoading && !assessment && (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No assessment available.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
