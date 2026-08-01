'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Mission } from '@agentlens/protocol';
import { api } from '@/lib/api';
import { extractRunFramework, filterLoadedRuns, formatRunTimestamp, formatRunToken, presentRunStatus, type RunStatusTone } from '@/lib/runPresentation';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

const STATUS_TONE_CLASSES: Record<RunStatusTone, string> = {
  active: 'text-[var(--color-info)]',
  success: 'text-[var(--color-success)]',
  warning: 'text-[var(--color-warning)]',
  error: 'text-[var(--color-error)]',
  neutral: 'text-[var(--color-text-secondary)]',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to load runs.';
}

export default function RunsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [missions, setMissions] = useState<Mission[]>([]);
  const [total, setTotal] = useState(0);
  const [nextPage, setNextPage] = useState(2);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const requestVersion = useRef(0);

  useEffect(() => {
    const version = ++requestVersion.current;
    let active = true;

    void api.missions
      .list(1, PAGE_SIZE, statusFilter || undefined)
      .then((response) => {
        if (!active || requestVersion.current !== version) return;
        setMissions(response.missions ?? []);
        setTotal(response.total ?? 0);
        setNextPage((response.page ?? 1) + 1);
        setLoadError(null);
      })
      .catch((error) => {
        if (!active || requestVersion.current !== version) return;
        setMissions([]);
        setTotal(0);
        setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (active && requestVersion.current === version) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retryToken, statusFilter]);

  const filteredMissions = useMemo(() => filterLoadedRuns(missions, searchQuery), [missions, searchQuery]);
  const hasMore = missions.length < total;
  const hasSearch = searchQuery.trim().length > 0;
  const resultSummary = hasSearch ? `${filteredMissions.length} matching ${filteredMissions.length === 1 ? 'run' : 'runs'} in ${missions.length} loaded of ${total} total` : `${missions.length} of ${total} ${total === 1 ? 'run' : 'runs'} loaded`;

  const resetForRequest = () => {
    requestVersion.current += 1;
    setMissions([]);
    setTotal(0);
    setNextPage(2);
    setIsLoading(true);
    setIsLoadingMore(false);
    setLoadError(null);
    setLoadMoreError(null);
  };

  const handleStatusChange = (nextStatus: string) => {
    resetForRequest();
    setStatusFilter(nextStatus);
  };

  const retryInitialLoad = () => {
    resetForRequest();
    setRetryToken((token) => token + 1);
  };

  const loadMore = async () => {
    if (isLoadingMore || !hasMore) return;

    const version = requestVersion.current;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    try {
      const response = await api.missions.list(nextPage, PAGE_SIZE, statusFilter || undefined);
      if (requestVersion.current !== version) return;

      setMissions((current) => {
        const byId = new Map(current.map((mission) => [mission.id, mission]));
        for (const mission of response.missions ?? []) byId.set(mission.id, mission);
        return Array.from(byId.values());
      });
      setTotal(response.total ?? total);
      setNextPage((response.page ?? nextPage) + 1);
    } catch (error) {
      if (requestVersion.current === version) setLoadMoreError(errorMessage(error));
    } finally {
      if (requestVersion.current === version) setIsLoadingMore(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <span className="text-[15px] font-semibold tracking-tight">AgentLens</span>
          <span className="h-4 w-px bg-[var(--color-border-subtle)]" aria-hidden="true" />
          <span className="text-[12px] text-[var(--color-text-secondary)]">Runtime debugger</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-9">
        <section aria-labelledby="runs-heading" aria-busy={isLoading || isLoadingMore}>
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 id="runs-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">
                Runs
              </h1>
              <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">Locate an execution and open its recorded runtime state.</p>
            </div>
            {!isLoading && !loadError && (
              <p className="text-[12px] tabular-nums text-[var(--color-text-secondary)]" role="status" aria-live="polite">
                {resultSummary}
              </p>
            )}
          </div>

          <form role="search" aria-label="Filter runs" className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => event.preventDefault()}>
            <div className="min-w-0 flex-1">
              <label htmlFor="run-search" className="mb-1.5 block text-[12px] font-medium">
                Search loaded runs
              </label>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
                <input id="run-search" name="run-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Objective or run ID" className="h-10 w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] pl-9 pr-3 text-[13px] outline-none placeholder:text-[var(--color-text-muted)] focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/20" />
              </div>
            </div>

            <div className="w-full sm:w-44">
              <label htmlFor="status-filter" className="mb-1.5 block text-[12px] font-medium">
                Status
              </label>
              <select id="status-filter" name="status-filter" value={statusFilter} onChange={(event) => handleStatusChange(event.target.value)} className="h-10 w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-3 text-[13px] outline-none focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/20">
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </form>

          {isLoading && (
            <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] px-5 py-10 text-center text-[13px] text-[var(--color-text-secondary)]" role="status" aria-live="polite">
              Loading runs…
            </div>
          )}

          {!isLoading && loadError && (
            <div role="alert" className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-bg-secondary)] p-5">
              <h2 className="text-[14px] font-semibold text-[var(--color-error)]">Missions unavailable:</h2>
              <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">{loadError}</p>
              <button type="button" onClick={retryInitialLoad} className="mt-4 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
                Retry
              </button>
            </div>
          )}

          {!isLoading && !loadError && filteredMissions.length === 0 && (
            <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] px-5 py-10 text-center">
              <h2 className="text-[14px] font-medium">{hasSearch ? 'No loaded runs match this search.' : 'No runs recorded.'}</h2>
              <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">{hasSearch ? 'Search covers the runs currently loaded on this page.' : statusFilter ? `No runs currently have the ${formatRunToken(statusFilter).toLowerCase()} status.` : 'Recorded executions will appear here.'}</p>
              {hasSearch && (
                <button type="button" onClick={() => setSearchQuery('')} className="mt-4 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
                  Clear search
                </button>
              )}
            </div>
          )}

          {!isLoading && !loadError && filteredMissions.length > 0 && (
            <div className="overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
              <div className="hidden border-b border-[var(--color-border-subtle)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)] md:grid md:grid-cols-[minmax(0,1fr)_7.5rem_9.5rem_11.5rem] md:gap-4 lg:grid-cols-[minmax(0,1fr)_7.5rem_9.5rem_10rem_11.5rem]" aria-hidden="true">
                <span>Run</span>
                <span>Status</span>
                <span>Phase</span>
                <span className="hidden lg:block">Framework</span>
                <span>Updated</span>
              </div>

              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {filteredMissions.map((mission) => {
                  const status = presentRunStatus(mission.status);
                  const framework = extractRunFramework(mission);

                  return (
                    <li key={mission.id}>
                      <Link href={`/missions/${mission.id}`} className="group grid gap-3 px-4 py-4 hover:bg-[var(--color-bg-hover)] focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)] md:grid-cols-[minmax(0,1fr)_7.5rem_9.5rem_11.5rem] md:items-center md:gap-4 lg:grid-cols-[minmax(0,1fr)_7.5rem_9.5rem_10rem_11.5rem]">
                        <div className="min-w-0">
                          <h2 className="truncate text-[14px] font-medium text-[var(--color-text-primary)]" title={mission.objective}>
                            {mission.objective}
                          </h2>
                          <code className="mt-1 block truncate text-[11px] text-[var(--color-text-muted)]" title={mission.id}>
                            {mission.id}
                          </code>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:contents">
                          <span className={`inline-flex items-center gap-2 text-[12px] font-medium ${STATUS_TONE_CLASSES[status.tone]}`} title={`Recorded status: ${mission.status || 'unknown'}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                            <span className="sr-only">Status: </span>
                            {status.label}
                          </span>
                          <span className="text-[12px] text-[var(--color-text-secondary)]">
                            <span className="sr-only">Phase: </span>
                            {formatRunToken(mission.phase)}
                          </span>
                          <span className="text-[12px] text-[var(--color-text-secondary)] md:hidden">{framework ? `Framework: ${framework}` : 'Framework not recorded'}</span>
                          <span className="hidden text-[12px] text-[var(--color-text-secondary)] lg:block">
                            <span className="sr-only">Framework: </span>
                            {framework ?? 'Not recorded'}
                          </span>
                        </div>

                        <time dateTime={mission.updated_at} className="text-[12px] tabular-nums text-[var(--color-text-secondary)]" title={mission.updated_at}>
                          <span className="sr-only">Updated: </span>
                          {formatRunTimestamp(mission.updated_at)}
                        </time>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {!isLoading && !loadError && loadMoreError && (
            <div className="mt-4 flex flex-col gap-3 rounded-md border border-[var(--color-error)]/30 bg-[var(--color-bg-secondary)] p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
              <p className="text-[12px] text-[var(--color-text-secondary)]">More runs could not be loaded: {loadMoreError}</p>
              <button type="button" onClick={() => void loadMore()} className="self-start rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] sm:self-auto">
                Retry load more
              </button>
            </div>
          )}

          {!isLoading && !loadError && hasMore && !loadMoreError && (
            <div className="mt-5 flex justify-center">
              <button type="button" onClick={() => void loadMore()} disabled={isLoadingMore} className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-4 py-2.5 text-[12px] font-medium hover:bg-[var(--color-bg-hover)] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
                {isLoadingMore ? 'Loading more…' : 'Load more runs'}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
