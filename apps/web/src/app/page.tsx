'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, CheckCircle2, Clock, GitBranch, Loader2, PauseCircle, Search, Telescope, Users, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { Mission } from '@agentlens/protocol';

type DashboardMission = Mission & { agent_count?: number };

const statusConfig: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  active: { icon: <Loader2 size={12} className="animate-spin" />, color: '#818cf8', bg: 'rgba(129,140,248,0.1)', label: 'Active' },
  completed: { icon: <CheckCircle2 size={12} />, color: '#34d399', bg: 'rgba(52,211,153,0.1)', label: 'Completed' },
  failed: { icon: <XCircle size={12} />, color: '#f87171', bg: 'rgba(248,113,113,0.1)', label: 'Failed' },
  paused: { icon: <PauseCircle size={12} />, color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', label: 'Paused' },
};

function DriftBadge({ score }: { score: number }) {
  const color = score < 0.2 ? '#34d399' : score < 0.5 ? '#fbbf24' : '#f87171';
  const label = score < 0.2 ? 'Low drift' : score < 0.5 ? 'Moderate drift' : 'High drift';
  return <div className="flex items-center gap-1.5 text-[10px]" style={{ color }}><Activity size={10} /><span>{label} ({Math.round(score * 100)}%)</span></div>;
}

export default function DashboardPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [missions, setMissions] = useState<DashboardMission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.missions.list(1, 50).then((response) => {
      if (!active) return;
      setMissions(response.missions ?? []);
      setLoadError(null);
    }).catch((error) => {
      if (!active) return;
      setMissions([]);
      setLoadError(error instanceof Error ? error.message : 'Failed to load missions.');
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => missions.filter((mission) => {
    if (searchQuery && !mission.objective.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return !statusFilter || mission.status === statusFilter;
  }), [missions, searchQuery, statusFilter]);

  const stats = {
    total: missions.length,
    active: missions.filter((mission) => mission.status === 'active').length,
    completed: missions.filter((mission) => mission.status === 'completed').length,
    agents: missions.reduce((total, mission) => total + (mission.agent_count ?? 0), 0),
  };

  return (
    <div className="min-h-screen bg-[#0a0b10]">
      <header className="sticky top-0 z-50 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.85)] backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3">
          <Telescope size={22} className="text-[#818cf8]" />
          <span className="text-[16px] font-bold gradient-text tracking-tight">AgentLens</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(99,102,241,0.1)] text-[#818cf8] font-medium">v0.1.0</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 gap-4 mb-8 md:grid-cols-4">
          {[
            { label: 'Total Missions', value: stats.total, icon: <GitBranch size={16} />, color: '#818cf8' },
            { label: 'Active', value: stats.active, icon: <Loader2 size={16} />, color: '#67e8f9' },
            { label: 'Completed', value: stats.completed, icon: <CheckCircle2 size={16} />, color: '#34d399' },
            { label: 'Total Agents', value: stats.agents, icon: <Users size={16} />, color: '#a78bfa' },
          ].map((stat) => <div key={stat.label} className="glass-card p-4"><div className="flex items-center justify-between mb-2"><span className="text-[11px] text-[#5d6180] font-medium uppercase tracking-wider">{stat.label}</span><span style={{ color: stat.color }}>{stat.icon}</span></div><div className="text-[28px] font-bold text-[#e8eaf0]">{stat.value}</div></div>)}
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5d6180]" /><input type="text" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search missions…" className="w-full pl-9 pr-4 py-2.5 text-[13px] rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] text-[#e8eaf0] placeholder:text-[#3a3d54]" /></div>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
            {[null, 'active', 'completed', 'failed', 'paused'].map((status) => <button type="button" key={status ?? 'all'} onClick={() => setStatusFilter(status)} className={`px-3 py-1.5 rounded-md text-[11px] font-medium ${statusFilter === status ? 'bg-[rgba(99,102,241,0.15)] text-[#818cf8]' : 'text-[#5d6180] hover:text-[#9498b0]'}`}>{status ? status.charAt(0).toUpperCase() + status.slice(1) : 'All'}</button>)}
          </div>
        </div>

        <div className="space-y-3">
          {isLoading && <div className="glass-card p-8 text-center text-[12px] text-[#9498b0]">Loading missions…</div>}
          {loadError && <div role="alert" className="rounded-xl border border-[rgba(248,113,113,0.18)] bg-[rgba(248,113,113,0.05)] p-5 text-[12px] text-[#fecaca]">Missions unavailable: {loadError}</div>}
          {!isLoading && !loadError && filtered.length === 0 && <div className="glass-card p-8 text-center text-[12px] text-[#9498b0]">No missions found.</div>}
          {filtered.map((mission) => {
            const status = statusConfig[mission.status] ?? statusConfig.paused;
            return <Link key={mission.id} href={`/missions/${mission.id}`} className="block"><div className="glass-card p-5 hover:border-[rgba(255,255,255,0.1)] transition-all group"><div className="flex items-start justify-between gap-4"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-1.5"><span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: status.bg, color: status.color }}>{status.icon}{status.label}</span><span className="text-[10px] text-[#3a3d54]">{String(mission.metadata.framework ?? 'custom')}</span></div><h2 className="text-[14px] font-semibold text-[#e8eaf0] mb-2 line-clamp-1">{mission.objective}</h2><div className="flex items-center gap-4 text-[11px] text-[#5d6180]"><span className="flex items-center gap-1.5"><Users size={11} />{mission.agent_count ?? 0} agents</span><span className="flex items-center gap-1.5"><Clock size={11} /><time dateTime={mission.updated_at} suppressHydrationWarning>{new Date(mission.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>{typeof mission.metadata.drift_score === 'number' && <DriftBadge score={mission.metadata.drift_score} />}</div></div><span className="flex items-center gap-1 text-[11px] text-[#818cf8] opacity-0 group-hover:opacity-100">Open<ArrowRight size={14} /></span></div></div></Link>;
          })}
        </div>
      </main>
    </div>
  );
}
