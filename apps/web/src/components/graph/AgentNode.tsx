'use client';

import { memo } from 'react';
import { Bot, User, Users } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import { NodeCard } from './NodeCard';
import { buildNodeCardView } from './nodePresentation';

function AgentNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const nodeType = typeof nodeData.nodeType === 'string' ? nodeData.nodeType : 'agent';
  const icon = nodeType === 'human' ? <User size={15} /> : nodeType === 'team' ? <Users size={15} /> : <Bot size={15} />;

  return <NodeCard view={buildNodeCardView('agent', nodeData)} icon={icon} selected={selected} highlighted={nodeData.highlighted === true} size="agent" />;
}

export const AgentNode = memo(AgentNodeComponent);
