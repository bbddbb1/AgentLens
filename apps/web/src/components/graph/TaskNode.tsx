'use client';

import { memo } from 'react';
import { ListChecks } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import { NodeCard } from './NodeCard';
import { buildNodeCardView } from './nodePresentation';

function TaskNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as Record<string, unknown>;

  return <NodeCard view={buildNodeCardView('task', nodeData)} icon={<ListChecks size={15} />} selected={selected} highlighted={nodeData.highlighted === true} size="task" />;
}

export const TaskNode = memo(TaskNodeComponent);
