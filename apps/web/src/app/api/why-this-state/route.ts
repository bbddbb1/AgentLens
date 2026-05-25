import { NextResponse } from 'next/server';
import { askAgentLens } from '@/lib/ai';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      missionId?: string;
      phase?: string;
      eventDescription?: string;
      agentStates?: Array<{ name: string; role: string; status: string; summary?: string }>;
      pendingInterrupts?: number;
    };

    if (!body.missionId) {
      return NextResponse.json({ error: 'missionId is required' }, { status: 400 });
    }

    const agentLines = (body.agentStates ?? [])
      .map((a) => `- ${a.name} (${a.role ?? 'unknown'}): ${a.status}${a.summary ? ` — ${a.summary}` : ''}`)
      .join('\n');

    const prompt = [
      `You are analyzing the current state of a multi-agent AI system.`,
      '',
      `Mission: "${body.missionId}"`,
      `Current phase: ${body.phase ?? 'executing'}`,
      `Pending human interrupts: ${body.pendingInterrupts ?? 0}`,
      '',
      `Agent states at this moment:`,
      agentLines || '(none)',
      '',
      `The most recent event was: ${body.eventDescription ?? 'none'}`,
      '',
      'Describe the SYSTEM-LEVEL state in 40-80 words. Do NOT narrate the event or say what just happened.',
      'Instead, characterize the overall situation:',
      '- What phase is the system in and what does that mean semantically?',
      '- Which agents are driving progress vs blocked vs idle — and WHY are they blocked?',
      '- Are there dependency chains, review bottlenecks, or handoff patterns?',
      '- Is the system progressing smoothly, stalled, or diverging?',
      '- What is the dominant dynamic shaping this moment (e.g. parallel execution, human-in-the-loop gate, critique loop, escalation)?',
      'Think like a system architect describing the topology and flow, not a log reader.',
      'Be concise and avoid listing agent names just to list them.',
    ].join('\n');

    const result = await askAgentLens(prompt, {
      missionId: body.missionId,
    });

    return NextResponse.json({ summary: result, conflicts: [], anomalies: [] });
  } catch {
    return NextResponse.json(
      { summary: null, conflicts: [], anomalies: [] },
      { status: 200 },
    );
  }
}
