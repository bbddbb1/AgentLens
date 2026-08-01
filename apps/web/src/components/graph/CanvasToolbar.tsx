'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Panel, useReactFlow } from '@xyflow/react';
import type { EdgeType } from '@agentlens/protocol';
import { ALL_EDGE_TYPES, type FocusDepth, type GraphDisplayPreset } from '@/lib/graphVisibility';
import { useGraphStore } from '@/stores/graphStore';
import { EDGE_PRESENTATION } from '@/lib/graphPresentation';

export const MINIMAP_NODE_THRESHOLD = 18;
const DETAIL_ZOOM = 1.25;

export function CanvasToolbar() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { zoomTo } = useReactFlow();
  const displayPreset = useGraphStore((state) => state.displayPreset);
  const edgeVisibility = useGraphStore((state) => state.edgeVisibility);
  const showConnectedOnly = useGraphStore((state) => state.showConnectedOnly);
  const showActiveOnly = useGraphStore((state) => state.showActiveOnly);
  const focusModeEnabled = useGraphStore((state) => state.focusModeEnabled);
  const focusDepth = useGraphStore((state) => state.focusDepth);
  const bundleEdges = useGraphStore((state) => state.bundleEdges);
  const showMinimap = useGraphStore((state) => state.showMinimap);
  const hiddenContext = useGraphStore((state) => state.hiddenContext);
  const relationshipContext = useGraphStore((state) => state.relationshipContext);
  const baseNodeCount = useGraphStore((state) => state.baseNodes.length);
  const setDisplayPreset = useGraphStore((state) => state.setDisplayPreset);
  const setEdgeTypeVisible = useGraphStore((state) => state.setEdgeTypeVisible);
  const setShowConnectedOnly = useGraphStore((state) => state.setShowConnectedOnly);
  const setShowActiveOnly = useGraphStore((state) => state.setShowActiveOnly);
  const setFocusModeEnabled = useGraphStore((state) => state.setFocusModeEnabled);
  const setFocusDepth = useGraphStore((state) => state.setFocusDepth);
  const setBundleEdges = useGraphStore((state) => state.setBundleEdges);
  const setShowMinimap = useGraphStore((state) => state.setShowMinimap);
  const setZoomLevel = useGraphStore((state) => state.setZoomLevel);
  const resetDisplay = useGraphStore((state) => state.resetDisplay);
  const minimapAvailable = baseNodeCount >= MINIMAP_NODE_THRESHOLD;

  useEffect(() => {
    if (!advancedOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAdvancedOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [advancedOpen]);

  const revealAll = () => {
    resetDisplay();
    setZoomLevel(DETAIL_ZOOM);
    void zoomTo(DETAIL_ZOOM, { duration: 180 });
    setAdvancedOpen(false);
  };

  return (
    <Panel position="top-right" className="!m-3 max-w-[min(34rem,calc(100vw-2rem))]">
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5 rounded-md border border-border-default bg-bg-secondary p-1.5 text-[11px] text-text-secondary">
          <label className="flex items-center gap-2 px-1.5">
            <span className="font-medium text-text-muted">View</span>
            <select aria-label="Graph view" value={displayPreset} onChange={(event) => setDisplayPreset(event.target.value as GraphDisplayPreset)} className="rounded-sm border border-border-default bg-bg-tertiary px-2 py-1 text-[11px] text-text-primary outline-none focus-visible:border-accent">
              <option value="all">All</option>
              <option value="orchestration">Orchestration</option>
              <option value="execution">Execution</option>
              <option value="data">Data</option>
              <option value="custom" disabled>
                Custom
              </option>
            </select>
          </label>
          <button type="button" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen} className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <SlidersHorizontal size={13} />
            Display
            <ChevronDown size={12} className={advancedOpen ? 'rotate-180' : ''} />
          </button>
        </div>

        {hiddenContext && (
          <div aria-live="polite" className="flex max-w-md items-start gap-3 rounded-md border border-warning/35 bg-bg-secondary px-3 py-2 text-[11px] leading-4 text-text-secondary">
            <span className="flex-1">{hiddenContext.disclosure}</span>
            <button type="button" onClick={revealAll} className="shrink-0 font-semibold text-warning hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              Reveal all
            </button>
          </div>
        )}

        {relationshipContext && <div className="max-w-md rounded-md border border-border-subtle bg-bg-tertiary px-3 py-2 text-[11px] text-text-muted">{relationshipContext.disclosure}</div>}

        {advancedOpen && (
          <div className="w-[min(31rem,calc(100vw-2rem))] rounded-md border border-border-default bg-bg-secondary p-3 text-[11px] text-text-secondary">
            <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
              <fieldset>
                <legend className="mb-2 text-[11px] font-semibold text-text-primary">Edge types</legend>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {ALL_EDGE_TYPES.map((type) => (
                    <EdgeTypeToggle key={type} type={type} checked={edgeVisibility[type]} onChange={(checked) => setEdgeTypeVisible(type, checked)} />
                  ))}
                </div>
              </fieldset>

              <fieldset className="space-y-2.5 border-t border-border-subtle pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                <legend className="mb-2 text-[11px] font-semibold text-text-primary">Context</legend>
                <Toggle label="Only nodes on visible edges" checked={showConnectedOnly} onChange={setShowConnectedOnly} />
                <Toggle label="Only active edges" checked={showActiveOnly} onChange={setShowActiveOnly} />
                <Toggle label="Focus around selection" checked={focusModeEnabled} onChange={setFocusModeEnabled} />
                <label className="flex items-center justify-between gap-3 text-text-secondary">
                  <span>Focus depth</span>
                  <select aria-label="Focus depth" value={focusDepth} disabled={!focusModeEnabled} onChange={(event) => setFocusDepth(Number(event.target.value) as FocusDepth)} className="rounded-sm border border-border-default bg-bg-tertiary px-2 py-1 text-text-primary disabled:opacity-45">
                    <option value={1}>1 hop</option>
                    <option value={2}>2 hops</option>
                  </select>
                </label>
                <Toggle label="Bundle parallel edges" checked={bundleEdges} onChange={setBundleEdges} />
                <Toggle label={minimapAvailable ? 'Show minimap' : `Minimap (${MINIMAP_NODE_THRESHOLD}+ nodes)`} checked={showMinimap && minimapAvailable} disabled={!minimapAvailable} onChange={setShowMinimap} />
              </fieldset>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
              <span className="text-[11px] text-text-muted">F toggles focus around the current selection.</span>
              <button type="button" onClick={revealAll} className="rounded-sm border border-border-default px-2.5 py-1 text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                Reset display
              </button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function EdgeTypeToggle({ type, checked, onChange }: { type: EdgeType; checked: boolean; onChange: (checked: boolean) => void }) {
  const presentation = EDGE_PRESENTATION[type];
  return (
    <label className="flex min-w-0 items-center gap-2 text-text-secondary">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-accent" />
      <span
        className="h-0 w-4 shrink-0 border-t-2"
        style={{
          borderColor: presentation.stroke,
          borderTopStyle: presentation.strokeDasharray ? 'dashed' : 'solid',
        }}
        aria-hidden="true"
      />
      <span className="truncate">{presentation.label}</span>
    </label>
  );
}

function Toggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`flex items-center justify-between gap-3 ${disabled ? 'text-text-faint' : 'text-text-secondary'}`}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="accent-accent" />
    </label>
  );
}
