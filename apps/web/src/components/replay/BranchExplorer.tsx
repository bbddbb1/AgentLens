'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, Plus, RefreshCw, Waypoints, Bot, AlertTriangle, Sparkles, Loader2, ChevronDown, ChevronUp, X, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';

interface BranchExplorerProps {
  missionId: string;
  onBranchChange: (branchId: string) => Promise<void>;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

function formatEventLabel(eventType: string): string {
  return eventType.replace(/[._]/g, ' ');
}

export function isEventBranchable(eventType?: string): boolean {
  if (!eventType) return false;
  return [
    'agent.registered',
    'interrupt.requested', 'interrupt.decision',
    'tool.called', 'tool.completed', 'tool.failed',
    'delegation', 'handoff.requested', 'escalation',
    'review.started', 'review.approved', 'review.changes_requested', 'review.rejected'
  ].includes(eventType);
}

async function mockFetchAiOverview(stateJson: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 800)); // simulate network delay
  try {
    const parsed = JSON.parse(stateJson);
    const keys = Object.keys(parsed);
    if (keys.length === 0) return "This node state is empty and contains no active data channels.";
    
    const summaryParts: string[] = [];
    if (parsed.change_plan) summaryParts.push("Contains a detailed operational rollout plan with 4 staging steps.");
    if (parsed.risk_summary) summaryParts.push("Specifies a high-level blocking review warning for customer support exports.");
    if (parsed.evidence_summary) summaryParts.push("Identifies active support export inventory evidence containing direct customer PII.");
    if (parsed.verification_gate) summaryParts.push(`Controls the gate decision for review block "${parsed.verification_gate}".`);
    
    if (summaryParts.length > 0) {
      return summaryParts.join(" ") + " AI recommends using strict data masking remediations on the child branch.";
    }
    
    return `Active state channels detected: ${keys.join(", ")}. Evaluated and ready for runtime override injection.`;
  } catch (e) {
    return "Failed to parse state structure. Please verify the target node state is in a valid JSON format.";
  }
}

export function BranchExplorer({ missionId, onBranchChange, isCollapsed, onToggleCollapsed }: BranchExplorerProps) {
  const { snapshots, selectedNodeId } = useGraphStore();
  const {
    branches,
    currentBranchId,
    events,
    currentFrame,
    currentState,
    setSelectedEventId,
    optimisticBranchCreated,
  } = useReplayStore();
  const [jobs, setJobs] = useState<any[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const currentSnapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
  const selectedNode = currentSnapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const visibleEvent = events[currentFrame] ?? events[events.length - 1] ?? null;
  const isBranchable = isEventBranchable(visibleEvent?.event_type);

  useEffect(() => {
    if (!missionId || missionId === 'demo-mission') return;
    api.replay.jobs(missionId).then((res) => setJobs(res.jobs)).catch(console.error);
  }, [missionId, currentBranchId, branches.length]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [mockDecisionEnabled, setMockDecisionEnabled] = useState(false);
  const [mockDecision, setMockDecision] = useState<'approve' | 'reject'>('approve');
  const [mockComment, setMockComment] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [overrideTask, setOverrideTask] = useState('');
  const [overrideGoal, setOverrideGoal] = useState('');

  // Target Gate ID state and Return Payload (Optional JSON) state
  const [targetGateId, setTargetGateId] = useState('');
  const [isPayloadOpen, setIsPayloadOpen] = useState(false);
  const [payloadJson, setPayloadJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // State Payload Override state
  const [stateOverrideEnabled, setStateOverrideEnabled] = useState(false);
  const [stateTarget, setStateTarget] = useState('');
  const [statePayloadJson, setStatePayloadJson] = useState('');
  const [stateJsonError, setStateJsonError] = useState<string | null>(null);
  const [isCurrentStatePanelOpen, setIsCurrentStatePanelOpen] = useState(false);
  const [aiOverview, setAiOverview] = useState<string | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);

  // Reset AI summary when target node selection changes
  useEffect(() => {
    setAiOverview(null);
    setIsLoadingAi(false);
  }, [stateTarget]);

  // JSON Validation Effect for Human Decision Return Payload
  useEffect(() => {
    if (!payloadJson.trim()) {
      setJsonError(null);
      return;
    }
    try {
      JSON.parse(payloadJson);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON format');
    }
  }, [payloadJson]);

  // JSON Validation Effect for State Override Payload
  useEffect(() => {
    if (!statePayloadJson.trim()) {
      setStateJsonError(null);
      return;
    }
    try {
      JSON.parse(statePayloadJson);
      setStateJsonError(null);
    } catch (e) {
      setStateJsonError(e instanceof Error ? e.message : 'Invalid JSON format');
    }
  }, [statePayloadJson]);

  // Dynamic fetching of current state based on Target Node ID
  const fetchedNodeState = useMemo(() => {
    if (!stateTarget.trim() || !events) return null;
    const target = stateTarget.trim().toLowerCase();

    // 1. First search: Scan snapshots for a node whose id, label, role, or agent_id matches the target
    const matchedNode = currentSnapshot?.nodes.find(
      (n) =>
        n.id.toLowerCase() === target ||
        n.id.toLowerCase() === `node:${target}` ||
        `node:${n.id.toLowerCase()}` === target ||
        n.label.toLowerCase() === target ||
        n.agent_role?.toLowerCase() === target ||
        n.agent_id?.toLowerCase() === target
    );

    // 2. Scan events timeline for any event that matches the target node ID, agent ID, span ID, or tool name
    const activeEvents = events.slice(0, currentFrame + 1);
    const matchedEvent = [...activeEvents].reverse().find((e) => {
      const payload = e.payload as any;
      if (e.agent_id?.toLowerCase() === target) return true;
      if (payload?.agent_id?.toLowerCase() === target) return true;
      if (payload?.task_id?.toLowerCase() === target) return true;
      if (payload?.tool_name?.toLowerCase() === target) return true;
      if (e.span_id?.toLowerCase() === target) return true;
      
      if (matchedNode) {
        if (e.span_id === matchedNode.span_id) return true;
        if (e.agent_id === matchedNode.id || payload?.agent_id === matchedNode.id) return true;
      }
      return false;
    });

    if (matchedEvent) {
      return {
        event_type: matchedEvent.event_type,
        sequence_num: matchedEvent.sequence_num,
        timestamp: matchedEvent.timestamp,
        ...(matchedEvent.payload ?? {}),
      };
    }

    if (matchedNode) {
      return {
        node_id: matchedNode.id,
        type: matchedNode.type,
        label: matchedNode.label,
        status: matchedNode.status,
        ...(matchedNode.metadata ?? {}),
      };
    }

    // 3. Fallback: Check currentState agents
    const matchedAgent = Object.values(currentState?.agents ?? {}).find(
      (a) =>
        a.agent_id.toLowerCase() === target ||
        a.name?.toLowerCase() === target ||
        a.role?.toLowerCase() === target
    );
    if (matchedAgent) {
      return {
        agent_id: matchedAgent.agent_id,
        name: matchedAgent.name,
        role: matchedAgent.role,
        status: matchedAgent.status,
        summary: matchedAgent.summary,
        ...(matchedAgent.metadata ?? {}),
      };
    }

    return null;
  }, [stateTarget, events, currentFrame, currentSnapshot, currentState]);

  const prefillStatePayload = () => {
    if (fetchedNodeState) {
      const { event_type, sequence_num, timestamp, node_id, ...cleanState } = fetchedNodeState as any;
      setStatePayloadJson(JSON.stringify(cleanState, null, 2));
    }
  };

  // Memoized lookups for selected agent details to show original context
  const selectedAgentObj = useMemo(() => {
    if (!selectedAgentId || !currentState?.agents) return null;
    return currentState.agents[selectedAgentId] ?? null;
  }, [selectedAgentId, currentState]);

  const selectedAgentNode = useMemo(() => {
    if (!selectedAgentId || !currentSnapshot?.nodes) return null;
    return currentSnapshot.nodes.find((n) => n.id === selectedAgentId && n.type === 'agent') ?? null;
  }, [selectedAgentId, currentSnapshot]);

  const originalTask = useMemo(() => {
    if (!selectedAgentId || !events) return '';
    // Find the latest task.started event for this agent up to the current frame
    const activeEvents = events.slice(0, currentFrame + 1);
    const taskEvent = [...activeEvents]
      .reverse()
      .find((e) => e.event_type === 'task.started' && (e.payload?.agent_id === selectedAgentId || e.agent_id === selectedAgentId));
    
    if (taskEvent?.payload?.task) {
      return taskEvent.payload.task as string;
    }

    // Fallback: check metadata as well
    if (selectedAgentObj) {
      return (
        (selectedAgentObj.metadata?.['agent.task'] as string) ||
        (selectedAgentObj.metadata?.task as string) ||
        (selectedAgentObj.metadata?.['task'] as string) ||
        (selectedAgentNode?.metadata?.['agent.task'] as string) ||
        (selectedAgentNode?.metadata?.task as string) ||
        ''
      );
    }
    return '';
  }, [selectedAgentId, events, currentFrame, selectedAgentObj, selectedAgentNode]);

  const originalGoal = useMemo(() => {
    if (!selectedAgentId || !events) return '';
    // Find the latest agent.registered event for this agent up to the current frame
    const activeEvents = events.slice(0, currentFrame + 1);
    const regEvent = [...activeEvents]
      .reverse()
      .find((e) => e.event_type === 'agent.registered' && (e.payload?.agent_id === selectedAgentId || e.agent_id === selectedAgentId));
    
    if (regEvent?.payload?.summary) {
      return regEvent.payload.summary as string;
    }

    // Fallback: check metadata as well
    if (selectedAgentObj) {
      return (
        (selectedAgentObj.metadata?.['agent.goal'] as string) ||
        (selectedAgentObj.metadata?.goal as string) ||
        (selectedAgentObj.metadata?.['goal'] as string) ||
        (selectedAgentNode?.metadata?.['agent.goal'] as string) ||
        (selectedAgentNode?.metadata?.goal as string) ||
        ''
      );
    }
    return '';
  }, [selectedAgentId, events, currentFrame, selectedAgentObj, selectedAgentNode]);

  const availableNodes = useMemo(() => {
    if (!currentSnapshot?.nodes) return [];
    return currentSnapshot.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
    }));
  }, [currentSnapshot]);

  const fromSequence = currentSnapshot?.source_event_sequence_num ?? visibleEvent?.sequence_num ?? 0;

  const openForkModal = () => {
    setBranchName(selectedNode ? `${selectedNode.label} fork` : `Branch @ ${fromSequence}`);
    setIsModalOpen(true);
    setIsAdvancedOpen(false);

    // Auto-detect pending interrupt or active interrupt event
    const pendingInt = Object.values(currentState?.interrupts ?? {}).find((i) => i.status === 'pending');
    const isInterrupt = visibleEvent?.event_type === 'interrupt.requested';
    setMockDecisionEnabled(isInterrupt || !!pendingInt);
    const detectedId = pendingInt?.interrupt_id || (visibleEvent?.payload as any)?.interrupt_id || '';
    setTargetGateId(String(detectedId));

    setMockDecision('approve');
    setMockComment('');
    setSelectedAgentId('');
    setOverrideTask('');
    setOverrideGoal('');

    setIsPayloadOpen(false);
    setPayloadJson('');
    setJsonError(null);

    setStateOverrideEnabled(false);
    setStateTarget('');
    setStatePayloadJson('');
    setStateJsonError(null);
    setIsCurrentStatePanelOpen(false);
    setAiOverview(null);
    setIsLoadingAi(false);
  };

  const handleCreateBranch = async () => {
    if (!missionId || missionId === 'demo-mission') return;
    if (jsonError || stateJsonError) return; // Prevent submission if validation errors exist
    setIsCreating(true);
    setError(null);
    setIsModalOpen(false);
    try {
      const injections: any[] = [];
      if (mockDecisionEnabled) {
        let parsedPayload: any = undefined;
        if (isPayloadOpen && payloadJson.trim()) {
          try {
            parsedPayload = JSON.parse(payloadJson);
          } catch (e) {
            // Fallback
          }
        }
        injections.push({
          type: 'human_decision',
          target: targetGateId.trim() || undefined,
          decision: mockDecision,
          comment: mockComment.trim() || undefined,
          payload: parsedPayload,
        });
      }
      if (selectedAgentId) {
        injections.push({
          type: 'prompt_injection',
          target: `agent:${selectedAgentId}`,
          task: overrideTask.trim() || undefined,
          goal: overrideGoal.trim() || undefined,
        });
      }
      if (stateOverrideEnabled && stateTarget.trim()) {
        let parsedStatePayload: any = {};
        if (statePayloadJson.trim()) {
          try {
            parsedStatePayload = JSON.parse(statePayloadJson);
          } catch (e) {
            // Fallback
          }
        }
        injections.push({
          type: 'state_override',
          target: stateTarget.trim(),
          payload: parsedStatePayload,
        });
      }

      const { branch } = await api.replay.createBranch(missionId, {
        name: branchName.trim() || `Branch @ ${fromSequence}`,
        source_branch_id: currentBranchId ?? undefined,
        forked_from_sequence_num: fromSequence,
        metadata: {
          selected_node_id: selectedNode?.id,
          selected_event_id: visibleEvent?.id,
          injections: injections.length > 0 ? injections : undefined,
        },
      });
      optimisticBranchCreated(branch);
      await onBranchChange(branch.id);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Failed to create branch.';
      if (msg.includes('executor_not_configured')) {
        setError('No active branch executor configured for this mission. Please register an executor via the SDK.');
      } else if (msg.includes('non_branchable_fork_point')) {
        setError('This event is not branchable. Please select a valid branch point (e.g. human decision or tool call).');
      } else {
        setError(msg);
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="glass rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(10,11,16,0.82)] p-3 shadow-[0_16px_48px_rgba(0,0,0,0.32)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[rgba(103,232,249,0.12)] text-[#67e8f9]">
            <GitBranch size={15} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#67e8f9]">
              Branches
            </div>
            <div className="text-[12px] text-[#cfd3e6]">
              Runtime forks and replay lineage
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={isCollapsed ? 'Expand branch explorer' : 'Collapse branch explorer'}
            className="inline-flex items-center justify-center rounded-lg border border-[rgba(255,255,255,0.08)] p-2 text-[#cfd3e6] transition-colors hover:bg-[rgba(255,255,255,0.04)]"
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            type="button"
            onClick={openForkModal}
            disabled={isCreating || !currentSnapshot || missionId === 'demo-mission' || !isBranchable}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(255,255,255,0.08)] px-3 py-2 text-[11px] text-[#e8eaf0] transition-colors hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-40"
          >
            {isCreating ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
            Branch Here
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div className="mt-3 grid gap-2">
            {branches.map((branch) => {
              const isActive = branch.id === currentBranchId;
              const branchJobs = jobs.filter((j) => j.branch_id === branch.id);
              const latestJob = branchJobs[0]; // assuming ordered by created_at DESC
              return (
                <button
                  type="button"
                  key={branch.id}
                  onClick={() => void onBranchChange(branch.id)}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-[rgba(103,232,249,0.24)] bg-[rgba(103,232,249,0.08)]'
                      : 'border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[12px] font-medium text-[#e8eaf0]">{branch.name}</div>
                    <span className="rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] text-[#8f95b2]">
                      {branch.status}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[#6d7392]">
                    <div>
                      {branch.parent_branch_id ? `Forked from ${branch.parent_branch_id}` : 'Root branch'}
                      {branch.forked_from_sequence_num !== undefined ? ` at event ${branch.forked_from_sequence_num}` : ''}
                    </div>
                    {latestJob && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.1em] ${latestJob.status === 'completed' ? 'bg-[#34d399]/20 text-[#34d399]' : latestJob.status === 'failed' ? 'bg-[#f87171]/20 text-[#f87171]' : 'bg-[#fbbf24]/20 text-[#fbbf24]'}`}>
                        {latestJob.status}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3">

            <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#fbbf24]">
                <Waypoints size={12} />
                Reconstructed Runtime
              </div>
              <div className="mt-3 grid gap-2">
                <div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[#6a718c]">Phase</div>
                  <div className="mt-1 text-[13px] font-medium text-[#f5f7ff]">{currentSnapshot?.phase ?? currentState?.phase ?? 'executing'}</div>
                </div>
                <div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[#6a718c]">Mission Status</div>
                  <div className="mt-1 text-[13px] font-medium text-[#f5f7ff]">{currentState?.status ?? 'active'}</div>
                </div>
                <div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[#6a718c]">
                    <span>Agents in State</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {Object.values(currentState?.agents ?? {}).slice(0, 4).map((agent) => (
                      <div key={agent.agent_id} className="flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex min-w-0 items-center gap-2 text-[#d7dbeb]">
                          <Bot size={11} className="text-[#818cf8]" />
                          <span className="truncate">{agent.name ?? agent.agent_id}</span>
                        </div>
                        <span className="inline-flex shrink-0 items-center rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[#a7aecb]">
                          {agent.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[#6a718c]">
                    <AlertTriangle size={10} />
                    Pending Interrupts
                  </div>
                  <div className="mt-1 text-[13px] font-medium text-[#f5f7ff]">
                    {Object.values(currentState?.interrupts ?? {}).filter((interrupt) => interrupt.status === 'pending').length}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error && <div className="mt-3 text-[11px] text-[#fca5a5]">{error}</div>}
        </>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#090a0f]/80 backdrop-blur-md transition-all duration-300">
          <div className="relative w-full max-w-lg rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#0f111a]/95 p-6 shadow-2xl backdrop-blur-xl transition-all duration-300 scale-100 flex flex-col gap-4">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] pb-3">
              <div className="flex items-center gap-2">
                <GitBranch className="text-[#67e8f9]" size={18} />
                <h3 className="text-base font-semibold text-[#f5f7ff]">Create Runtime Fork</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1.5 text-[#8f95b2] hover:bg-[rgba(255,255,255,0.05)] hover:text-white transition-all duration-150"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              
              {/* Branch Name Field */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8f95b2]">
                  Fork Branch Name
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="Enter branch name..."
                  className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-[13px] text-[#f5f7ff] placeholder-[#5d6180] outline-none transition-all focus:border-[#67e8f9]/50 focus:bg-[rgba(255,255,255,0.05)]"
                />
                <p className="text-[10px] text-[#6d7392]">
                  Forking execution from sequence <span className="font-mono text-[#67e8f9]">#{fromSequence}</span> ({formatEventLabel(visibleEvent?.event_type ?? '')})
                </p>
              </div>

              {/* Advanced Injection Accordion */}
              <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-all hover:bg-[rgba(255,255,255,0.04)]"
                >
                  <div className="flex items-center gap-2">
                    <Settings size={14} className="text-[#818cf8]" />
                    <span className="text-[12px] font-medium text-[#cfd3e6]">Advanced Injection Options</span>
                  </div>
                  {isAdvancedOpen ? (
                    <ChevronUp size={14} className="text-[#8f95b2]" />
                  ) : (
                    <ChevronDown size={14} className="text-[#8f95b2]" />
                  )}
                </button>

                {isAdvancedOpen && (
                  <div className="border-t border-[rgba(255,255,255,0.06)] p-4 space-y-4 bg-[rgba(10,11,16,0.5)]">
                    
                    {/* Mock Decision Group */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-[12px] font-medium text-[#e8eaf0]">Mock Human Review</span>
                          <span className="text-[10px] text-[#6d7392]">Bypass gates with automated response</span>
                        </div>
                        <label className="relative inline-flex cursor-pointer items-center">
                          <input
                            type="checkbox"
                            checked={mockDecisionEnabled}
                            onChange={(e) => setMockDecisionEnabled(e.target.checked)}
                            className="peer sr-only"
                          />
                          <div className="peer h-5 w-9 rounded-full bg-[rgba(255,255,255,0.1)] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-[#8f95b2] after:transition-all after:content-[''] peer-checked:bg-[#67e8f9] peer-checked:after:translate-x-full peer-checked:after:bg-[#0f111a] peer-focus:outline-none"></div>
                        </label>
                      </div>

                      {mockDecisionEnabled && (
                        <div className="space-y-3 pl-2 border-l-2 border-[rgba(103,232,249,0.3)] animate-in fade-in slide-in-from-left-2 duration-200">
                          
                          {/* Target Gate ID Selection/Input */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] uppercase tracking-[0.08em] text-[#6d7392]">Target Gate ID</span>
                              <span className="text-[9px] text-[#5d6180]">Matches interrupt node</span>
                            </div>
                            {Object.values(currentState?.interrupts ?? {}).filter(i => i.status === 'pending').length > 0 ? (
                              <select
                                value={targetGateId}
                                onChange={(e) => setTargetGateId(e.target.value)}
                                className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(20,22,33,0.95)] px-3 py-2 text-[12px] text-[#f5f7ff] outline-none focus:border-[#67e8f9]/50"
                              >
                                <option value="">Select active gate...</option>
                                {Object.values(currentState?.interrupts ?? {}).filter(i => i.status === 'pending').map((i) => (
                                  <option key={i.interrupt_id} value={i.interrupt_id}>
                                    {i.interrupt_id} ({i.reason.slice(0, 30)}...)
                                  </option>
                                ))}
                                <option value="__custom__">Custom Gate ID...</option>
                              </select>
                            ) : null}
                            {(Object.values(currentState?.interrupts ?? {}).filter(i => i.status === 'pending').length === 0 || targetGateId === '__custom__' || !Object.values(currentState?.interrupts ?? {}).some(i => i.interrupt_id === targetGateId)) && (
                              <input
                                type="text"
                                value={targetGateId === '__custom__' ? '' : targetGateId}
                                onChange={(e) => setTargetGateId(e.target.value)}
                                placeholder="Enter target gate ID (e.g. security_review)..."
                                className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-[12px] text-[#f5f7ff] placeholder-[#5d6180] outline-none transition-all focus:border-[#67e8f9]/50 focus:bg-[rgba(255,255,255,0.04)]"
                              />
                            )}
                          </div>

                          {/* Segmented Control */}
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase tracking-[0.08em] text-[#6d7392]">Decision</span>
                            <div className="flex rounded-xl bg-[rgba(255,255,255,0.03)] p-1 border border-[rgba(255,255,255,0.06)] relative">
                              <button
                                type="button"
                                onClick={() => setMockDecision('approve')}
                                className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-all ${
                                  mockDecision === 'approve'
                                    ? 'bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/30 shadow-[0_2px_8px_rgba(16,185,129,0.15)]'
                                    : 'text-[#8f95b2] hover:text-white hover:bg-[rgba(255,255,255,0.02)] border border-transparent'
                                }`}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => setMockDecision('reject')}
                                className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-all ${
                                  mockDecision === 'reject'
                                    ? 'bg-[#f43f5e]/20 text-[#fb7185] border border-[#f43f5e]/30 shadow-[0_2px_8px_rgba(244,63,94,0.15)]'
                                    : 'text-[#8f95b2] hover:text-white hover:bg-[rgba(255,255,255,0.02)] border border-transparent'
                                }`}
                              >
                                Reject
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[10px] uppercase tracking-[0.08em] text-[#6d7392]">Reviewer Note / Comment</span>
                            <textarea
                              value={mockComment}
                              onChange={(e) => setMockComment(e.target.value)}
                              placeholder="Reasoning for decision (e.g. reject due to PII violation)..."
                              rows={2}
                              className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[12px] text-[#f5f7ff] placeholder-[#5d6180] outline-none transition-all focus:border-[#67e8f9]/50 focus:bg-[rgba(255,255,255,0.04)] resize-none"
                            />
                          </div>

                          {/* Return Payload Collapsible */}
                          <div className="space-y-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => setIsPayloadOpen(!isPayloadOpen)}
                              className="flex items-center justify-between w-full py-1 text-[11px] font-medium text-[#cfd3e6] hover:text-white transition-colors"
                            >
                              <span className="uppercase tracking-[0.06em]">Return Payload (Optional JSON)</span>
                              {isPayloadOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                            
                            {isPayloadOpen && (
                              <div className="space-y-1 animate-in fade-in duration-200">
                                <textarea
                                  value={payloadJson}
                                  onChange={(e) => setPayloadJson(e.target.value)}
                                  placeholder={`{\n  "verification_code": "123456",\n  "mask_pii": true\n}`}
                                  rows={3}
                                  className={`w-full rounded-xl border bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[12px] font-mono text-[#f5f7ff] placeholder-[#5d6180] outline-none transition-all focus:bg-[rgba(255,255,255,0.04)] resize-none ${
                                    jsonError
                                      ? 'border-[#f43f5e] focus:border-[#f43f5e]'
                                      : 'border-[rgba(255,255,255,0.08)] focus:border-[#67e8f9]/50'
                                  }`}
                                />
                                {jsonError && (
                                  <span className="text-[10px] text-[#f43f5e] block mt-0.5">{jsonError}</span>
                                )}
                              </div>
                            )}
                          </div>

                        </div>
                      )}
                    </div>

                    <div className="h-[1px] bg-[rgba(255,255,255,0.06)]" />

                    {/* Agent Persona Override Group */}
                    <div className="space-y-3">
                      <div className="flex flex-col">
                        <span className="text-[12px] font-medium text-[#e8eaf0]">Agent Persona Override</span>
                        <span className="text-[10px] text-[#6d7392]">Modify runtime prompt, task, or goal instructions</span>
                      </div>

                      <div className="space-y-2.5">
                        <select
                          value={selectedAgentId}
                          onChange={(e) => setSelectedAgentId(e.target.value)}
                          className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(20,22,33,0.95)] px-3 py-2 text-[12px] text-[#f5f7ff] outline-none focus:border-[#67e8f9]/50"
                        >
                          <option value="">Select agent to override...</option>
                          {Object.values(currentState?.agents ?? {}).map((agent) => (
                            <option key={agent.agent_id} value={agent.agent_id}>
                              {agent.name ?? agent.agent_id}
                            </option>
                          ))}
                        </select>

                        {selectedAgentId && (
                          <div className="space-y-3 pl-2 border-l-2 border-[rgba(129,140,248,0.3)] animate-in fade-in slide-in-from-left-2 duration-200">
                            
                            {/* Task Override with Context Visibility */}
                            <div className="space-y-1">
                              <span className="text-[10px] uppercase tracking-[0.08em] text-[#6d7392]">Task Override</span>
                              {originalTask && (
                                <div className="rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)] px-2.5 py-1.5 text-[11px] text-[#8f95b2] break-words">
                                  <span className="text-[9px] uppercase tracking-[0.05em] text-[#5d6180] block mb-0.5">Original Task</span>
                                  {originalTask}
                                </div>
                              )}
                              <input
                                type="text"
                                value={overrideTask}
                                onChange={(e) => setOverrideTask(e.target.value)}
                                placeholder="E.g. Mask all sensitive customer emails..."
                                className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-[12px] text-[#f5f7ff] placeholder-[#5d6180] outline-none transition-all focus:border-[#67e8f9]/50 focus:bg-[rgba(255,255,255,0.04)]"
                              />
                            </div>

                            {/* Goal Override with Context Visibility */}
                            <div className="space-y-1">
                              <span className="text-[10px] uppercase tracking-[0.08em] text-[#6d7392]">Goal Override</span>
                              {originalGoal && (
                                <div className="rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)] px-2.5 py-1.5 text-[11px] text-[#8f95b2] break-words">
                                  <span className="text-[9px] uppercase tracking-[0.05em] text-[#5d6180] block mb-0.5">Original Goal</span>
                                  {originalGoal}
                                </div>
                              )}
                              <input
                                type="text"
                                value={overrideGoal}
                                onChange={(e) => setOverrideGoal(e.target.value)}
                                placeholder="E.g. No PII should leave the application..."
                                className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-[12px] text-[#f5f7ff] placeholder-[#5d6180] outline-none transition-all focus:border-[#67e8f9]/50 focus:bg-[rgba(255,255,255,0.04)]"
                              />
                            </div>

                          </div>
                        )}
                      </div>
                    </div>

                    <div className="h-[1px] bg-[rgba(255,255,255,0.06)]" />

                    {/* State Payload Override Group */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-[12px] font-medium text-[#e8eaf0]">State Payload Override</span>
                          <span className="text-[10px] text-[#6d7392]">Merge/override target node state channels</span>
                        </div>
                        <label className="relative inline-flex cursor-pointer items-center">
                          <input
                            type="checkbox"
                            checked={stateOverrideEnabled}
                            onChange={(e) => setStateOverrideEnabled(e.target.checked)}
                            className="peer sr-only"
                          />
                          <div className="peer h-5 w-9 rounded-full bg-[rgba(255,255,255,0.1)] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-[#8f95b2] after:transition-all after:content-[''] peer-checked:bg-[#67e8f9] peer-checked:after:translate-x-full peer-checked:after:bg-[#0f111a] peer-focus:outline-none"></div>
                        </label>
                      </div>

                      {stateOverrideEnabled && (
                        <div className="space-y-3 pl-2 border-l-2 border-[rgba(103,232,249,0.3)] animate-in fade-in slide-in-from-left-2 duration-200">
                          
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase tracking-[0.08em] text-[#6d7392]">Target Node</span>
                            <select
                              value={stateTarget}
                              onChange={(e) => setStateTarget(e.target.value)}
                              className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(20,22,33,0.95)] px-3 py-2 text-[12px] text-[#f5f7ff] outline-none focus:border-[#67e8f9]/50"
                            >
                              <option value="">Select target node...</option>
                              {availableNodes.map((node) => (
                                <option key={node.id} value={node.id}>
                                  {node.label} ({node.type})
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Collapsible Current Node State Reference */}
                          <div className="space-y-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => setIsCurrentStatePanelOpen(!isCurrentStatePanelOpen)}
                              className="flex items-center justify-between w-full py-1 text-[11px] font-medium text-[#cfd3e6] hover:text-white transition-colors"
                            >
                              <span className="uppercase tracking-[0.06em]">View Current Node State</span>
                              {isCurrentStatePanelOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>

                            {isCurrentStatePanelOpen && (
                              <div className="space-y-2 animate-in fade-in duration-200">
                                {fetchedNodeState ? (
                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[9px] uppercase tracking-[0.05em] text-[#5d6180]">
                                        State resolved at sequence #{(fetchedNodeState as any).sequence_num ?? fromSequence}
                                      </span>
                                      <div className="flex items-center gap-3">
                                        <button
                                          type="button"
                                          disabled={isLoadingAi}
                                          onClick={async () => {
                                            if (!fetchedNodeState) return;
                                            setIsLoadingAi(true);
                                            setAiOverview(null);
                                            try {
                                              const summary = await mockFetchAiOverview(JSON.stringify(fetchedNodeState));
                                              setAiOverview(summary);
                                            } catch (e) {
                                              setAiOverview("Error generating state explanation.");
                                            } finally {
                                              setIsLoadingAi(false);
                                            }
                                          }}
                                          className="flex items-center gap-1 text-[9px] font-semibold text-[#818cf8] hover:text-[#a5b4fc] transition-colors disabled:opacity-50"
                                        >
                                          {isLoadingAi ? (
                                            <Loader2 size={10} className="animate-spin text-[#818cf8]" />
                                          ) : (
                                            <Sparkles size={10} />
                                          )}
                                          <span>Explain State</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={prefillStatePayload}
                                          className="text-[9px] font-semibold text-[#67e8f9] hover:underline"
                                        >
                                          Copy to Editor
                                        </button>
                                      </div>
                                    </div>

                                    {isLoadingAi && (
                                      <div className="rounded-xl border border-[rgba(129,140,248,0.12)] bg-[rgba(129,140,248,0.04)] px-3 py-2 text-[11px] text-[#cfd3e6] leading-relaxed animate-pulse flex items-center gap-2">
                                        <Loader2 size={11} className="animate-spin text-[#818cf8]" />
                                        <span>Analyzing causal state pathways...</span>
                                      </div>
                                    )}

                                    {aiOverview && !isLoadingAi && (
                                      <div className="rounded-xl border border-[rgba(103,232,249,0.15)] bg-[rgba(103,232,249,0.06)] px-3 py-2 text-[11px] text-[#e8eaf0] leading-relaxed flex items-start gap-2 animate-in fade-in duration-200">
                                        <Sparkles size={11} className="text-[#67e8f9] shrink-0 mt-0.5" />
                                        <p className="flex-1 text-left">{aiOverview}</p>
                                      </div>
                                    )}

                                    <pre className="w-full max-h-[120px] overflow-y-auto rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.3)] p-2 text-[10px] font-mono text-[#a7aecb] whitespace-pre-wrap break-all">
                                      {JSON.stringify(fetchedNodeState, null, 2)}
                                    </pre>
                                  </div>
                                ) : (
                                  <div className="rounded-xl border border-dashed border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] px-3 py-3 text-[11px] text-[#6d7392] italic">
                                    No state found for &ldquo;{stateTarget}&rdquo;. Enter a valid node ID (e.g. planner, analyst).
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="space-y-1">
                            <span className="text-[10px] uppercase tracking-[0.08em] text-[#6d7392]">State Payload (JSON)</span>
                            <textarea
                              value={statePayloadJson}
                              onChange={(e) => setStatePayloadJson(e.target.value)}
                              placeholder={`{\n  "change_plan": "Strict masking"\n}`}
                              rows={3}
                              className={`w-full rounded-xl border bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[12px] font-mono text-[#f5f7ff] placeholder-[#5d6180] outline-none transition-all focus:bg-[rgba(255,255,255,0.04)] resize-none ${
                                stateJsonError
                                  ? 'border-[#f43f5e] focus:border-[#f43f5e]'
                                  : 'border-[rgba(255,255,255,0.08)] focus:border-[#67e8f9]/50'
                              }`}
                            />
                            {stateJsonError && (
                              <span className="text-[10px] text-[#f43f5e] block mt-0.5">{stateJsonError}</span>
                            )}
                          </div>

                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>

            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-[rgba(255,255,255,0.08)] pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-xl border border-[rgba(255,255,255,0.08)] px-4 py-2 text-[12px] font-medium text-[#cfd3e6] transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateBranch}
                disabled={
                  isCreating || 
                  !branchName.trim() || 
                  !!jsonError || 
                  !!stateJsonError || 
                  (stateOverrideEnabled && !stateTarget.trim()) || 
                  (mockDecisionEnabled && !targetGateId.trim())
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#06b6d4] to-[#3b82f6] px-4 py-2 text-[12px] font-semibold text-white shadow-lg shadow-cyan-500/20 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                {isCreating ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Creating Fork...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={13} />
                    <span>Create Fork</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
