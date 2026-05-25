import { NextResponse } from 'next/server';
import { askAgentLens } from '@/lib/ai';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      missionId?: string;
      missionObjective?: string;
      missionStatus?: string;
    };

    if (!body.prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const response = await askAgentLens(body.prompt, {
      missionId: body.missionId,
      missionObjective: body.missionObjective,
      missionStatus: body.missionStatus,
    });

    return NextResponse.json({ response });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Assistant request failed' },
      { status: 500 },
    );
  }
}
