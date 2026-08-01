'use client';

import { memo } from 'react';
import { Database, FileText, Wrench } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import { NodeCard } from './NodeCard';
import { buildNodeCardView } from './nodePresentation';

function ToolNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const nodeType = typeof nodeData.nodeType === 'string' ? nodeData.nodeType : 'tool';
  const icon = nodeType === 'memory' ? <Database size={14} /> : nodeType === 'artifact' ? <FileText size={14} /> : <Wrench size={14} />;

  return <NodeCard view={buildNodeCardView('tool', nodeData)} icon={icon} selected={selected} highlighted={nodeData.highlighted === true} size="tool" />;
}

export const ToolNode = memo(ToolNodeComponent);
