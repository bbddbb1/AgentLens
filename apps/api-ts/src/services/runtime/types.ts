import {
  MissionEventRecord,
  GraphNode,
  GraphEdge,
  RuntimeAgentState,
  RuntimeInterruptState
} from '@agentlens/protocol';

export const ROOT_BRANCH_ID = 'main';

export type PendingMissionEvent = Omit<MissionEventRecord, 'id' | 'sequence_num' | 'branch_sequence_num'>;

export interface InternalRuntimeState {
  mission_id: string;
  branch_id: string;
  status: string;
  phase: string;
  sequence_num: number;
  last_event_id?: string;
  last_event_type?: string;
  last_updated_at?: string;
  agents: Record<string, RuntimeAgentState>;
  interrupts: Record<string, RuntimeInterruptState>;
  nodeMap: Map<string, GraphNode>;
  edgeMap: Map<string, GraphEdge>;
  agentOrder: string[];
}
