import { useReplayStore } from '@/stores/replayStore';
import { useGraphStore } from '@/stores/graphStore';
import { AgentStateCard } from './AgentStateCard';
import { InterruptBadge } from './InterruptBadge';
import { WhyThisState } from '@/components/replay/WhyThisState';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { Activity } from 'lucide-react';

export function StateInspector({ missionId }: { missionId: string }) {
  const { currentState } = useReplayStore();
  const { selectedNodeId, setSelectedNodeId } = useGraphStore();

  const agents = Object.values(currentState?.agents ?? {});
  const pendingInterrupts = Object.values(currentState?.interrupts ?? {}).filter(i => i.status === 'pending');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-5">
          {pendingInterrupts.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[10px] uppercase tracking-wider text-[#9498b0]">Pending Interrupts</h4>
              {pendingInterrupts.map(interrupt => (
                <InterruptBadge key={interrupt.interrupt_id} interrupt={interrupt} />
              ))}
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-[10px] uppercase tracking-wider text-[#9498b0]">Agents</h4>
            <div className="grid gap-2">
              {agents.map(agent => {
                const isSelected = selectedNodeId === agent.agent_id || selectedNodeId === agent.name;
                
                return (
                  <AgentStateCard 
                    key={agent.agent_id} 
                    agent={agent} 
                    isSelected={isSelected}
                    onClick={() => setSelectedNodeId(agent.agent_id)}
                  />
                );
              })}
            </div>
          </div>
          
          <div>
            <WhyThisState missionId={missionId} />
          </div>
        </div>
      </div>
    </div>
  );
}
