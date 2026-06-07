'use client';

import { useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '@/stores/graphStore';
import { computeEdgeDensityHotspots } from '@/lib/graphVisibility';

export function DensityHeatmap() {
  const { baseNodes, baseEdges } = useGraphStore();
  const { setCenter, getZoom } = useReactFlow();

  const hotspots = useMemo(
    () => computeEdgeDensityHotspots(baseNodes, baseEdges),
    [baseNodes, baseEdges],
  );

  if (hotspots.length === 0) return null;

  return (
    <div className="absolute bottom-4 right-[156px] z-40 flex flex-col gap-1">
      <span className="text-[8px] uppercase tracking-wider text-[#5d6180] font-bold px-1">
        Density
      </span>
      <div className="flex flex-wrap gap-1 max-w-[120px]">
        {hotspots.map((spot, index) => (
          <button
            key={`${spot.x}-${spot.y}`}
            onClick={() => setCenter(spot.x, spot.y, { zoom: getZoom(), duration: 400 })}
            className="w-5 h-5 rounded-full border border-[rgba(248,113,113,0.3)] transition-transform hover:scale-110"
            style={{
              backgroundColor: `rgba(248, 113, 113, ${Math.min(0.15 + spot.density * 0.08, 0.7)})`,
              boxShadow: `0 0 ${4 + spot.density}px rgba(248, 113, 113, 0.3)`,
            }}
            title={`${spot.density} edges — click to navigate`}
          >
            <span className="sr-only">Hotspot {index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
