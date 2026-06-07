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
  const pathOffset = typeof data?.pathOffset === 'number' ? data.pathOffset : 0;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY: sourceY + pathOffset * 0.15,
    sourcePosition,
    targetX,
    targetY: targetY + pathOffset * 0.15,
    targetPosition,
    borderRadius: 16,
    offset: pathOffset,
  });

  const edgeType = data?.edgeType as string;
  const isDataFlow = edgeType === 'data_flow' || edgeType === 'uses' || edgeType === 'produces';
  const disableParticles = data?.disableParticles === true;

  const showParticles =
    !disableParticles &&
    (animated || (isDataFlow && data?.status === 'active'));

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
