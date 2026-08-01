import { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from '@xyflow/react';

export function BundledEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd, data, label }: EdgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const pathOffset = typeof data?.pathOffset === 'number' ? data.pathOffset : 0;
  const edgeType = typeof data?.edgeType === 'string' ? data.edgeType : 'connection';
  const bundled = data?.bundled === true;
  const bundleCount = typeof data?.bundleCount === 'number' ? data.bundleCount : 1;
  const highlighted = data?.highlighted === true;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY: sourceY + pathOffset * 0.15,
    sourcePosition,
    targetX,
    targetY: targetY + pathOffset * 0.15,
    targetPosition,
    borderRadius: 12,
    offset: pathOffset,
  });

  const displayLabel = label || (bundled ? `${edgeType} ×${bundleCount}` : edgeType);
  const strokeWidth = typeof style.strokeWidth === 'number' ? style.strokeWidth : 1.5;

  return (
    <>
      <g onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            ...style,
            strokeWidth: highlighted ? strokeWidth + 0.8 : strokeWidth,
            opacity: highlighted ? 1 : (style.opacity ?? 0.82),
          }}
          interactionWidth={18}
        />
      </g>

      {(isHovered || bundled || highlighted) && displayLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
            className="rounded-sm border border-border-default bg-bg-tertiary px-1.5 py-0.5 text-[11px] text-text-secondary"
          >
            {displayLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
