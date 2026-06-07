import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
} from '@xyflow/react';

export function BundledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  animated,
  label,
}: EdgeProps) {
  const [isHovered, setIsHovered] = useState(false);

  const pathOffset = typeof data?.pathOffset === 'number' ? data.pathOffset : 0;
  const edgeType = data?.edgeType as string | undefined;
  const bundled = data?.bundled === true;
  const bundleCount = typeof data?.bundleCount === 'number' ? data.bundleCount : 1;
  const disableParticles = data?.disableParticles === true;
  const highlighted = data?.highlighted === true;
  const dimmed = data?.dimmed === true;
  const hidden = data?.hidden === true;

  const offsetY = isHovered && bundled ? pathOffset + (pathOffset >= 0 ? 8 : -8) : pathOffset;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY: sourceY + offsetY * 0.15,
    sourcePosition,
    targetX,
    targetY: targetY + offsetY * 0.15,
    targetPosition,
    borderRadius: 16,
    offset: offsetY,
  });

  const isDataFlow = edgeType === 'data_flow' || edgeType === 'uses' || edgeType === 'produces';
  const showParticles =
    !disableParticles &&
    !dimmed &&
    !hidden &&
    (animated || (isDataFlow && data?.status === 'active'));

  if (hidden) return null;

  const strokeColor = (style.stroke as string) || '#5d6180';
  const displayLabel = label || (bundled ? `${edgeType} ×${bundleCount}` : undefined);

  return (
    <>
      <g
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            ...style,
            opacity: dimmed ? 0.15 : highlighted ? 1 : (style.opacity ?? 1),
            filter: highlighted ? `drop-shadow(0 0 4px ${strokeColor})` : undefined,
            transition: 'opacity 200ms ease, filter 200ms ease',
          }}
          interactionWidth={20}
        />

        {showParticles && (
          <circle r="4" fill={strokeColor} style={{ filter: 'drop-shadow(0 0 3px currentColor)' }}>
            <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
          </circle>
        )}

        {highlighted && (
          <BaseEdge
            path={edgePath}
            style={{
              stroke: strokeColor,
              strokeWidth: 3,
              strokeDasharray: '8 6',
              opacity: 0.8,
              pointerEvents: 'none',
              animation: 'dash-flow 2s linear infinite',
            }}
          />
        )}
      </g>

      {(isHovered || bundled || highlighted) && displayLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="px-1.5 py-0.5 rounded-md bg-[rgba(18,19,26,0.92)] border border-[rgba(255,255,255,0.08)] text-[9px] font-mono text-[#cfd3e6] shadow-lg backdrop-blur-sm"
          >
            {displayLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
