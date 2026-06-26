'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
} from 'lucide-react';
import type { RuntimeNodeProjection } from '@agentlens/protocol';
import { renderRuntimeEventRef } from '@agentlens/protocol';
import { safePreview } from '@/lib/safePreview';

interface AgentNodeProjectionPanelProps {
  projection: RuntimeNodeProjection;
  nodeType?: string;
  onEnhance?: () => Promise<unknown>;
  isEnhancing?: boolean;
}

export function AgentNodeProjectionPanel({
  projection,
  nodeType = 'agent',
  onEnhance,
  isEnhancing = false,
}: AgentNodeProjectionPanelProps) {
  const [showEvents, setShowEvents] = useState(false);
  const [showUnderstanding, setShowUnderstanding] = useState(false);
  const [expandedOutputs, setExpandedOutputs] = useState<Record<string, boolean>>({});

  const understanding = projection.generated?.current_understanding;
  const isLlmEnhanced = projection.generated?.source === 'llm';

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.015)] hover:bg-[rgba(255,255,255,0.025)] p-3.5 relative overflow-hidden group transition-all duration-300">
      <div className="border-l-3 border-[#6366f1] pl-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#818cf8]" />
            <span className="text-[9px] uppercase tracking-[0.12em] text-[#818cf8] font-bold">Selected Node</span>
          </div>
          <span className="text-[9px] bg-[rgba(99,102,241,0.1)] text-[#a5b4fc] border border-[#6366f1]/20 px-2 py-0.5 rounded-md font-mono uppercase tracking-wide">
            {nodeType}
          </span>
        </div>

        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold text-white tracking-wide">{projection.name}</div>
            {projection.generated?.suggested_title && (
              <div className="text-[10px] text-[#7b819f] mt-0.5">{projection.generated.suggested_title}</div>
            )}
          </div>
          <Bot size={14} className="text-[#5d6180] shrink-0 mt-0.5" />
        </div>

        {projection.facts.role && (
          <Section title="Role">
            <p className="text-[11px] text-[#9498b0] leading-relaxed">{projection.facts.role}</p>
          </Section>
        )}

        <Section title="Status">
          <p className="text-[11px] text-[#d0d4ea]">{projection.facts.status_label}</p>
        </Section>

        {projection.facts.produced_outputs.length > 0 && (
          <Section title="Produced Outputs">
            <ul className="space-y-1.5">
              {projection.facts.produced_outputs.map((output) => {
                const preview = safePreview(output.value);
                const outputKey = `${output.type}-${output.id}`;
                const isExpanded = expandedOutputs[outputKey];

                return (
                  <li key={outputKey} className="text-[10px] text-[#9498b0]">
                    <div className="flex items-center gap-2">
                      <span className="text-[#d0d4ea] font-medium">{output.name}</span>
                      <span className="text-[9px] text-[#5d6180]">({output.type})</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-[#6b708a] break-all">
                      {isExpanded || !preview.truncated ? preview.text : preview.text}
                      {preview.truncated && (
                        <button
                          type="button"
                          onClick={() => setExpandedOutputs((prev) => ({ ...prev, [outputKey]: !isExpanded }))}
                          className="ml-1 text-[#818cf8] hover:text-[#a5b4fc]"
                        >
                          {isExpanded ? 'less' : 'more'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        <Section title="Next Transition">
          <p className="text-[11px] text-[#9498b0]">
            {projection.facts.next_transition
              ? `→ ${projection.facts.next_transition.target} (${projection.facts.next_transition.kind})`
              : 'None'}
          </p>
        </Section>

        <Section title="Pending">
          <p className="text-[11px] text-[#9498b0]">{projection.facts.pending ?? 'None'}</p>
        </Section>

        {(projection.facts.warnings.length > 0 || (projection.generated?.llm_warnings?.length ?? 0) > 0) && (
          <Section title="Warnings">
            <ul className="space-y-1">
              {projection.facts.warnings.map((warning, index) => (
                <li key={`fact-${index}`} className="flex items-start gap-1.5 text-[10px] text-[#f87171]">
                  <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                  <span>{warning.message}</span>
                </li>
              ))}
              {projection.generated?.llm_warnings?.map((warning, index) => (
                <li key={`llm-${index}`} className="flex items-start gap-1.5 text-[10px] text-[#fbbf24]">
                  <Sparkles size={10} className="shrink-0 mt-0.5" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {projection.recent_runtime_events.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowEvents((value) => !value)}
              className="flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-[#5d6180] hover:text-[#9498b0]"
            >
              Recent Runtime Events ({projection.recent_runtime_events.length})
              {showEvents ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            <AnimatePresence initial={false}>
              {showEvents && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mt-1.5 space-y-0.5 overflow-hidden"
                >
                  {projection.recent_runtime_events.map((ref) => (
                    <li key={`${ref.sequence_num}-${ref.event_type}`} className="text-[10px] text-[#7b819f] flex gap-1.5">
                      <span className="text-[#34d399] shrink-0">✓</span>
                      <span>{renderRuntimeEventRef(ref)}</span>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )}

        {understanding && (
          <div className="pt-2 border-t border-[rgba(255,255,255,0.05)]">
            <button
              type="button"
              onClick={() => setShowUnderstanding((v) => !v)}
              className="flex w-full items-center justify-between text-[9px] uppercase tracking-[0.12em] text-[#818cf8] hover:text-[#a5b4fc] font-bold"
            >
              <div className="flex items-center gap-1.5">
                <span className="bg-[#f43f5e]/10 text-[#f43f5e] border border-[#f43f5e]/20 px-1.5 py-0.5 rounded text-[8px] font-mono tracking-wider font-bold">
                  [INTERPRETATION]
                </span>
                <span>Current Understanding</span>
              </div>
              <div className="flex items-center gap-2">
                {onEnhance && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      void onEnhance();
                    }}
                    className="flex items-center gap-1 text-[9px] text-[#818cf8] hover:text-[#a5b4fc] normal-case font-normal"
                  >
                    {isEnhancing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                    {isEnhancing ? 'Enhancing…' : 'Enhance'}
                  </span>
                )}
                {showUnderstanding ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </div>
            </button>
            <AnimatePresence initial={false}>
              {showUnderstanding && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mt-2 overflow-hidden space-y-1.5"
                >
                  {isLlmEnhanced && (
                    <span className="inline-flex items-center gap-1 mb-1 px-1.5 py-0.5 rounded-full bg-[rgba(129,140,248,0.12)] text-[#a5b4fc] text-[8px] font-semibold uppercase tracking-wide">
                      AI-enhanced
                    </span>
                  )}
                  <p className="text-[11px] text-[#9498b0] leading-relaxed">{understanding}</p>
                  {projection.generated?.highlights && projection.generated.highlights.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {projection.generated.highlights.map((item, index) => (
                        <li key={index} className="text-[10px] text-[#7b819f] flex gap-1.5">
                          <span className="text-[#6366f1]">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[9px] uppercase tracking-[0.12em] text-[#5d6180]">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}
