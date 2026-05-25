'use client';

/**
 * AgentLens Dashboard 閳?Mission listing page.
 * Shows all missions with status, agent count, and quick actions.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Telescope, Plus, Search, Filter, Clock, Users,
  CheckCircle2, XCircle, Loader2, PauseCircle,
  Shield, Eye, Lock, ArrowRight, Zap, GitBranch,
  BarChart3, Activity,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { Mission } from '@agentlens/protocol';

type DashboardMission = Mission & { agent_count?: number; review_count?: number };

// 閳光偓閳光偓閳光偓 Demo data for showcase 閳光偓閳光偓閳光偓
const DEMO_MISSIONS: DashboardMission[] = [
  {
    id: 'demo-1',
    objective: 'Research quarterly AI safety report and generate executive summary',
    status: 'completed' as const,
    phase: 'completed' as const,
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
    agent_count: 5,
    review_count: 3,
    is_encrypted: true,
    visibility: 'team',
    metadata: { framework: 'LangGraph', drift_score: 0.12 },
  },
  {
    id: 'demo-2',
    objective: 'Analyze competitor product landscape and generate SWOT matrix',
    status: 'active' as const,
    phase: 'executing' as const,
    created_at: new Date(Date.now() - 1800000).toISOString(),
    updated_at: new Date(Date.now() - 60000).toISOString(),
    agent_count: 4,
    review_count: 1,
    is_encrypted: false,
    visibility: 'private',
    metadata: { framework: 'CrewAI', drift_score: 0.34 },
  },
  {
    id: 'demo-3',
    objective: 'Debug production authentication service and propose fix',
    status: 'failed' as const,
    phase: 'failed' as const,
    created_at: new Date(Date.now() - 7200000).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 1.5).toISOString(),
    agent_count: 3,
    review_count: 2,
    is_encrypted: true,
    visibility: 'private',
    metadata: { framework: 'AutoGen', drift_score: 0.67 },
  },
  {
    id: 'demo-4',
    objective: 'Plan and execute multi-channel marketing campaign for Q3 launch',
    status: 'active' as const,
    phase: 'reviewing' as const,
    created_at: new Date(Date.now() - 5400000).toISOString(),
    updated_at: new Date(Date.now() - 300000).toISOString(),
    agent_count: 7,
    review_count: 4,
    is_encrypted: false,
    visibility: 'team',
    metadata: { framework: 'LangGraph', drift_score: 0.08 },
  },
  {
    id: 'demo-5',
    objective: 'Code review and refactor legacy payment processing module',
    status: 'paused' as const,
    phase: 'executing' as const,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 43200000).toISOString(),
    agent_count: 4,
    review_count: 0,
    is_encrypted: true,
    visibility: 'private',
    metadata: { framework: 'OpenAI Agents', drift_score: 0.21 },
  },
];

const statusConfig: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  active: {
    icon: <Loader2 size={12} className="animate-spin" />,
    color: '#818cf8', bg: 'rgba(129,140,248,0.1)', label: 'Active',
  },
  completed: {
    icon: <CheckCircle2 size={12} />,
    color: '#34d399', bg: 'rgba(52,211,153,0.1)', label: 'Completed',
  },
  failed: {
    icon: <XCircle size={12} />,
    color: '#f87171', bg: 'rgba(248,113,113,0.1)', label: 'Failed',
  },
  paused: {
    icon: <PauseCircle size={12} />,
    color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', label: 'Paused',
  },
};

function DriftBadge({ score }: { score: number }) {
  const color = score < 0.2 ? '#34d399' : score < 0.5 ? '#fbbf24' : '#f87171';
  const label = score < 0.2 ? 'Low drift' : score < 0.5 ? 'Moderate drift' : 'High drift';
  return (
    <div className="flex items-center gap-1.5 text-[10px]" style={{ color }}>
      <Activity size={10} />
      <span>{label} ({Math.round(score * 100)}%)</span>
    </div>
  );
}

export default function DashboardPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [missions, setMissions] = useState<DashboardMission[]>(DEMO_MISSIONS);

  useEffect(() => {
    let isActive = true;

    async function loadMissions(): Promise<void> {
      try {
        const response = await api.missions.list(1, 50);
        const apiMissions = response?.missions ?? [];
        if (isActive && apiMissions.length) {
          setMissions(apiMissions);
        }
      } catch {
        if (isActive) {
          setMissions(DEMO_MISSIONS);
        }
      }
    }

    loadMissions();
    return () => {
      isActive = false;
    };
  }, []);

  const filtered = missions.filter((m) => {
    if (searchQuery && !m.objective.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter && m.status !== statusFilter) return false;
    return true;
  });

  const stats = {
    total: missions.length,
    active: missions.filter((m) => m.status === 'active').length,
    completed: missions.filter((m) => m.status === 'completed').length,
    agents: missions.reduce((a, m) => a + (m.agent_count ?? 0), 0),
  };

  return (
    <div className="min-h-screen bg-[#0a0b10]">
      {/* 閳光偓閳光偓閳光偓 Header 閳光偓閳光偓閳光偓 */}
      <header className="sticky top-0 z-50 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.85)] backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Telescope size={22} className="text-[#818cf8]" />
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#34d399] animate-pulse" />
            </div>
            <span className="text-[16px] font-bold gradient-text tracking-tight">AgentLens</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(99,102,241,0.1)] text-[#818cf8] font-medium">
              v0.1.0
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#6366f1] text-white hover:bg-[#5558e6] transition-all shadow-lg shadow-[#6366f1]/20 hover:shadow-[#6366f1]/30">
              <Plus size={14} />
              New Mission
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#6366f1] to-[#a78bfa] flex items-center justify-center text-[11px] font-bold text-white cursor-pointer">
              AL
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* 閳光偓閳光偓閳光偓 Stats 閳光偓閳光偓閳光偓 */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Missions', value: stats.total, icon: <GitBranch size={16} />, color: '#818cf8' },
            { label: 'Active', value: stats.active, icon: <Zap size={16} />, color: '#67e8f9' },
            { label: 'Completed', value: stats.completed, icon: <CheckCircle2 size={16} />, color: '#34d399' },
            { label: 'Total Agents', value: stats.agents, icon: <Users size={16} />, color: '#a78bfa' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className="glass-card p-4 hover:border-[rgba(255,255,255,0.08)] transition-colors cursor-default group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-[#5d6180] font-medium uppercase tracking-wider">{stat.label}</span>
                <div style={{ color: stat.color }} className="opacity-50 group-hover:opacity-100 transition-opacity">
                  {stat.icon}
                </div>
              </div>
              <div className="text-[28px] font-bold text-[#e8eaf0] tracking-tight">{stat.value}</div>
            </motion.div>
          ))}
        </div>

        {/* 閳光偓閳光偓閳光偓 Search & Filter 閳光偓閳光偓閳光偓 */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5d6180]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search missions..."
              className="w-full pl-9 pr-4 py-2.5 text-[13px] rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] text-[#e8eaf0] placeholder:text-[#3a3d54] focus:outline-none focus:border-[#6366f1]/30 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
            {[null, 'active', 'completed', 'failed', 'paused'].map((s) => (
              <button
                key={s || 'all'}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-[rgba(99,102,241,0.15)] text-[#818cf8]'
                    : 'text-[#5d6180] hover:text-[#9498b0]'
                }`}
              >
                {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
              </button>
            ))}
          </div>
        </div>

        {/* 閳光偓閳光偓閳光偓 Mission List 閳光偓閳光偓閳光偓 */}
        <div className="space-y-3">
          <AnimatePresence>
            {filtered.map((mission, i) => {
              const sc = statusConfig[mission.status];
              return (
                <motion.div
                  key={mission.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ delay: i * 0.03, duration: 0.3 }}
                >
                  <Link href={`/missions/${mission.id}`}>
                    <div className="glass-card p-5 hover:border-[rgba(255,255,255,0.1)] transition-all group cursor-pointer">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <div
                              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                              style={{ background: sc.bg, color: sc.color }}
                            >
                              {sc.icon}
                              {sc.label}
                            </div>
                            {mission.is_encrypted && (
                              <div className="flex items-center gap-1 text-[10px] text-[#34d399]">
                                <Lock size={9} />
                                <span>E2E</span>
                              </div>
                            )}
                            <span className="text-[10px] text-[#3a3d54]">
                              {String(mission.metadata.framework ?? 'custom')}
                            </span>
                          </div>
                          <h3 className="text-[14px] font-semibold text-[#e8eaf0] mb-2 line-clamp-1 group-hover:text-white transition-colors">
                            {mission.objective}
                          </h3>
                          <div className="flex items-center gap-4 text-[11px] text-[#5d6180]">
                            <div className="flex items-center gap-1.5">
                              <Users size={11} />
                              <span>{mission.agent_count} agents</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Shield size={11} />
                              <span>{mission.review_count} reviews</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Clock size={11} />
                              <span>{new Date(mission.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <DriftBadge score={typeof mission.metadata.drift_score === 'number' ? mission.metadata.drift_score : 0} />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[11px] text-[#818cf8] font-medium">Open</span>
                          <ArrowRight size={14} className="text-[#818cf8]" />
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
