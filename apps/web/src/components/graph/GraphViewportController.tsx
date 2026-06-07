'use client';

import { useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '@/stores/graphStore';

const MIN_READABLE_ZOOM = 0.88;
const MAX_INITIAL_ZOOM = 1.15;

export function GraphViewportController() {
  const { fitView, getZoom, getViewport, setViewport } = useReactFlow();
  const baseNodeKey = useGraphStore((state) =>
    state.baseNodes.map((node) => node.id).join('|'),
  );
  const setZoomLevel = useGraphStore((state) => state.setZoomLevel);
  const lastFitKeyRef = useRef('');

  useEffect(() => {
    if (!baseNodeKey) return;
    if (lastFitKeyRef.current === baseNodeKey) return;
    lastFitKeyRef.current = baseNodeKey;

    const timer = window.setTimeout(() => {
      void fitView({
        padding: 0.1,
        minZoom: MIN_READABLE_ZOOM,
        maxZoom: MAX_INITIAL_ZOOM,
        duration: 200,
      }).then(() => {
        const zoom = getZoom();
        if (zoom < MIN_READABLE_ZOOM) {
          const viewport = getViewport();
          void setViewport(
            { ...viewport, zoom: MIN_READABLE_ZOOM },
            { duration: 150 },
          );
          setZoomLevel(MIN_READABLE_ZOOM);
          return;
        }
        setZoomLevel(zoom);
      });
    }, 50);

    return () => window.clearTimeout(timer);
  }, [baseNodeKey, fitView, getZoom, getViewport, setViewport, setZoomLevel]);

  return null;
}
