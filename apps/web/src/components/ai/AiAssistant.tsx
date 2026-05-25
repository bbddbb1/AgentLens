'use client';

import { useState } from 'react';
import { Bot, Send, Sparkles, X } from 'lucide-react';

interface AiAssistantProps {
  missionId: string;
  missionObjective: string;
  missionStatus?: string;
}

export function AiAssistant({ missionId, missionObjective, missionStatus }: AiAssistantProps) {
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
