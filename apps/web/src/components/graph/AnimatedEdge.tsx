import { BaseEdge, EdgeProps, getSmoothStepPath } from '@xyflow/react';

export function AnimatedEdge({
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
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edgeType = data?.edgeType as string;
  const isDataFlow = edgeType === 'data_flow' || edgeType === 'uses' || edgeType === 'produces';
  
  // If it's explicitly animated, we show particles
  const showParticles = animated || (isDataFlow && data?.status === 'active');

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      
      {showParticles && (
        <circle r="4" fill={style.stroke || '#60a5fa'} style={{ filter: 'drop-shadow(0 0 3px currentColor)' }}>
          <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
    </>
  );
}
