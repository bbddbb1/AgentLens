'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLayoutStore } from '@/stores/layoutStore';

interface WorkspaceShellProps {
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
  bottomPanel: ReactNode;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable || target.closest('[contenteditable="true"]') !== null;
}

export function WorkspaceShell({ leftPanel, centerPanel, rightPanel, bottomPanel }: WorkspaceShellProps) {
  const { isLeftCollapsed, isRightCollapsed, setIsLeftCollapsed, setIsRightCollapsed } = useLayoutStore();
  const [isCompact, setIsCompact] = useState<boolean | null>(null);
  const leftToggleRef = useRef<HTMLButtonElement>(null);
  const rightToggleRef = useRef<HTMLButtonElement>(null);
  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);
  const lastCompactPanelRef = useRef<'left' | 'right' | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1279px)');
    const applyViewport = (compact: boolean) => {
      setIsCompact(compact);
      if (compact) {
        setIsLeftCollapsed(true);
        setIsRightCollapsed(true);
      }
    };
    applyViewport(query.matches);
    const handleChange = (event: MediaQueryListEvent) => applyViewport(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, [setIsLeftCollapsed, setIsRightCollapsed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === '[') {
        const willOpen = useLayoutStore.getState().isLeftCollapsed;
        if (isCompact && willOpen) setIsRightCollapsed(true);
        setIsLeftCollapsed(!willOpen);
      } else if (event.key === ']') {
        const willOpen = useLayoutStore.getState().isRightCollapsed;
        if (isCompact && willOpen) setIsLeftCollapsed(true);
        setIsRightCollapsed(!willOpen);
      } else if (event.key === 'Escape' && isCompact) {
        setIsLeftCollapsed(true);
        setIsRightCollapsed(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompact, setIsLeftCollapsed, setIsRightCollapsed]);

  useEffect(() => {
    if (isCompact !== true) {
      const closedPanel = lastCompactPanelRef.current;
      if (closedPanel) {
        (closedPanel === 'left' ? leftToggleRef.current : rightToggleRef.current)?.focus();
      }
      lastCompactPanelRef.current = null;
      return;
    }

    const openPanel = !isLeftCollapsed ? 'left' : !isRightCollapsed ? 'right' : null;
    if (openPanel) {
      lastCompactPanelRef.current = openPanel;
      const panel = openPanel === 'left' ? leftPanelRef.current : rightPanelRef.current;
      const firstControl = panel?.querySelector<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      (firstControl ?? panel)?.focus();
      return;
    }

    const closedPanel = lastCompactPanelRef.current;
    if (closedPanel) {
      (closedPanel === 'left' ? leftToggleRef.current : rightToggleRef.current)?.focus();
      lastCompactPanelRef.current = null;
    }
  }, [isCompact, isLeftCollapsed, isRightCollapsed]);

  const toggleLeft = () => {
    const willOpen = isLeftCollapsed;
    if (isCompact && willOpen) setIsRightCollapsed(true);
    setIsLeftCollapsed(!isLeftCollapsed);
  };

  const toggleRight = () => {
    const willOpen = isRightCollapsed;
    if (isCompact && willOpen) setIsLeftCollapsed(true);
    setIsRightCollapsed(!isRightCollapsed);
  };

  const compactPanelOpen = isCompact === true && (!isLeftCollapsed || !isRightCollapsed);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-bg-primary">
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {isCompact === false && !isLeftCollapsed && (
          <aside id="timeline-panel" aria-label="Execution timeline" className="flex w-[280px] shrink-0 flex-col border-r border-border-subtle bg-bg-secondary">
            {leftPanel}
          </aside>
        )}

        <main className="relative flex min-w-0 flex-1 flex-col" inert={compactPanelOpen}>
          <button ref={leftToggleRef} type="button" onClick={toggleLeft} aria-label={isLeftCollapsed ? 'Open execution timeline' : 'Close execution timeline'} aria-controls="timeline-panel" aria-expanded={!isLeftCollapsed} className="absolute left-0 top-1/2 z-50 flex h-12 w-7 -translate-y-1/2 items-center justify-center rounded-r-sm border border-l-0 border-border-default bg-bg-secondary text-text-secondary hover:bg-bg-hover hover:text-text-primary">
            {isLeftCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>

          {centerPanel}

          <button ref={rightToggleRef} type="button" onClick={toggleRight} aria-label={isRightCollapsed ? 'Open runtime inspector' : 'Close runtime inspector'} aria-controls="inspector-panel" aria-expanded={!isRightCollapsed} className="absolute right-0 top-1/2 z-50 flex h-12 w-7 -translate-y-1/2 items-center justify-center rounded-l-sm border border-r-0 border-border-default bg-bg-secondary text-text-secondary hover:bg-bg-hover hover:text-text-primary">
            {isRightCollapsed ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
          </button>
        </main>

        {isCompact === false && !isRightCollapsed && (
          <aside id="inspector-panel" aria-label="Runtime inspector" className="flex w-[360px] shrink-0 flex-col border-l border-border-subtle bg-bg-secondary">
            {rightPanel}
          </aside>
        )}

        {compactPanelOpen && (
          <button
            type="button"
            aria-label="Close open workspace panel"
            onClick={() => {
              setIsLeftCollapsed(true);
              setIsRightCollapsed(true);
            }}
            className="absolute inset-0 z-30 bg-black/50"
          />
        )}
        {isCompact === true && !isLeftCollapsed && (
          <aside ref={leftPanelRef} tabIndex={-1} id="timeline-panel" aria-label="Execution timeline" className="absolute inset-y-0 left-0 z-40 flex w-[min(320px,calc(100%_-_48px))] flex-col border-r border-border-default bg-bg-secondary shadow-float">
            {leftPanel}
          </aside>
        )}
        {isCompact === true && !isRightCollapsed && (
          <aside ref={rightPanelRef} tabIndex={-1} id="inspector-panel" aria-label="Runtime inspector" className="absolute inset-y-0 right-0 z-40 flex w-[min(380px,calc(100%_-_48px))] flex-col border-l border-border-default bg-bg-secondary shadow-float">
            {rightPanel}
          </aside>
        )}
      </div>

      <div className="h-[52px] shrink-0 border-t border-border-subtle bg-bg-primary" inert={compactPanelOpen}>
        {bottomPanel}
      </div>
    </div>
  );
}
