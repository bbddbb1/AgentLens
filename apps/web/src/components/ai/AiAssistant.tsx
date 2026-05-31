'use client';

import { useState } from 'react';
import { Bot, Send, Sparkles, X } from 'lucide-react';

interface AiAssistantProps {
  missionId: string;
  missionObjective: string;
  missionStatus?: string;
  inline?: boolean;
}

export function AiAssistant({ missionId, missionObjective, missionStatus, inline }: AiAssistantProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResponse('');

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          missionId,
          missionObjective,
          missionStatus,
        }),
      });

      const data = (await res.json()) as { response?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Assistant request failed');
      setResponse(data.response || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant request failed');
    } finally {
      setLoading(false);
    }
  }

  if (inline) {
    return (
      <div className="flex flex-col h-full bg-[#12131a]">
        <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.05)] px-4 py-3 bg-[rgba(10,11,16,0.3)]">
          <Bot size={16} className="text-[#818cf8]" />
          <div>
            <div className="text-xs font-semibold text-[#e8eaf0]">Pi Assistant</div>
            <div className="text-[10px] text-[#5d6180]">Mission-aware coding interface</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask about this mission, the graph, or what to do next..."
              className="h-28 w-full resize-none rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs text-[#e8eaf0] placeholder:text-[#3a3d54] outline-none focus:border-[#6366f1]/30 focus:bg-[rgba(255,255,255,0.05)] transition-all duration-200"
            />

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#6366f1] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#5558e6] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send size={12} />
              {loading ? 'Thinking...' : 'Ask Pi'}
            </button>

            {error ? <div className="text-[11px] text-[#f87171]">{error}</div> : null}

            {response ? (
              <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3 text-xs leading-6 text-[#d8dbef] whitespace-pre-wrap">
                {response}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(17,18,28,0.92)] px-4 py-2 text-sm font-medium text-[#e8eaf0] shadow-2xl shadow-black/30 backdrop-blur-xl transition hover:border-[#6366f1]/30 hover:text-white"
        >
          <Sparkles size={14} className="text-[#818cf8]" />
          Ask Pi
        </button>
      ) : (
        <div className="w-[360px] rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(12,13,20,0.96)] shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-[#818cf8]" />
              <div>
                <div className="text-sm font-semibold text-[#e8eaf0]">Pi Assistant</div>
                <div className="text-[11px] text-[#5d6180]">Mission-aware coding interface</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-[#5d6180] hover:text-[#e8eaf0] transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3 p-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask about this mission, the graph, or what to do next..."
              className="h-24 w-full resize-none rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-[#e8eaf0] placeholder:text-[#3a3d54] outline-none focus:border-[#6366f1]/30"
            />

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#6366f1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#5558e6] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send size={14} />
              {loading ? 'Thinking...' : 'Ask Pi'}
            </button>

            {error ? <div className="text-xs text-[#f87171]">{error}</div> : null}

            {response ? (
              <div className="max-h-64 overflow-auto rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3 text-sm leading-6 text-[#d8dbef] whitespace-pre-wrap">
                {response}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
