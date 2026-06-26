import { RuntimeAgentState } from '@agentlens/protocol';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { CheckCircle2, Circle, XCircle, Loader2 } from 'lucide-react';

const statusIcons: Record<string, React.ReactNode> = {
  idle: <Circle size={12} className="text-[#5d6180]" />,
  active: <Loader2 size={12} className="text-[#818cf8] animate-spin" />,
  completed: <CheckCircle2 size={12} className="text-[#34d399]" />,
  failed: <XCircle size={12} className="text-[#f87171]" />,
  waiting: <Circle size={12} className="text-[#fbbf24]" />,
};

interface AgentStateCardProps {
  agent: RuntimeAgentState;
  isSelected?: boolean;
  onClick?: () => void;
}

/**
 * ROPS compliance: the `behavior` prop (fed from `generated.current_understanding`,
 * forbidden by P4) has been removed. Only Evidence is rendered: agent identity,
 * lifecycle status, `agent.summary` (Evidence), `current_task_id` (Evidence),
 * and `confidence` (Evidence when emitter-set on RuntimeAgentState).
 */
export function AgentStateCard({ agent, isSelected, onClick }: AgentStateCardProps) {
  const status = agent.status || 'idle';
  const confidence = agent.confidence;

  return (
    <GlassPanel
      hoverable
      onClick={onClick}
      className={isSelected ? '!border-[rgba(255,255,255,0.2)] !bg-[rgba(255,255,255,0.06)]' : ''}
    >
      <div className="flex items-start gap-3">
        <AgentAvatar agentId={agent.agent_id} role={agent.role} size="md" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-medium text-[#e8eaf0] truncate">{agent.name || agent.agent_id}</div>
            <div className="flex items-center gap-1 text-[10px] text-[#9498b0]">
              {statusIcons[status]}
              <span className="capitalize">{status}</span>
            </div>
          </div>

          <div className="text-[10px] text-[#5d6180] truncate mt-0.5">
            {agent.role} {agent.team ? `• ${agent.team}` : ''}
          </div>

          {/* Evidence-only summary. Absent when not emitted (P7). */}
          {agent.summary && (
            <div className="mt-2 text-[10px] text-[#9498b0] leading-relaxed line-clamp-2 italic">
              {agent.summary}
            </div>
          )}

          {agent.current_task_id && (
            <div className="mt-2 text-[10px] text-[#cfd3e6] truncate">
              Task: {agent.current_task_id}
            </div>
          )}

          {confidence !== undefined && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1 flex-1 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                <div
                  className="h-full bg-[#818cf8] rounded-full"
                  style={{ width: `${confidence * 100}%` }}
                />
              </div>
              <span className="text-[9px] text-[#5d6180] w-6 text-right">{Math.round(confidence * 100)}%</span>
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
