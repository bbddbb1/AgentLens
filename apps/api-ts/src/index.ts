import 'dotenv/config';
import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { checkDatabaseHealth, initializeDatabase } from './db/postgres.js';
import { missionsRouter } from './routes/missions.js';
import { extrasRouter } from './routes/extras.js';
import { branchesRouter } from './routes/branches.js';
import { langGraphBridgeRouter } from './routes/langgraphBridge.js';
import { mafBridgeRouter } from './routes/mafBridge.js';
import { realtimeManager } from './realtime/missions.js';
import { sandboxRunner } from './services/runtime/SandboxJobRunner.js';

const app = express();

app.use(
  cors({
    origin: (process.env.CORS_ORIGINS ?? process.env.API_CORS_ORIGINS)?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  }),
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? '10mb' }));

app.use(missionsRouter);
app.use(extrasRouter);
app.use(branchesRouter);
app.use(langGraphBridgeRouter);
app.use(mafBridgeRouter);

app.get('/api/health', async (_req, res) => {
  try {
    await checkDatabaseHealth();
    res.json({ status: 'ok', database: 'ok', version: '0.1.0-ts' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'database unavailable';
    res.status(503).json({ status: 'degraded', database: 'error', detail, version: '0.1.0-ts' });
  }
});

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8001);

async function bootstrap(): Promise<void> {
  await initializeDatabase();
  await sandboxRunner.start();

  const server = http.createServer(app);
  realtimeManager.attach(server);
  await realtimeManager.initialize();

  server.listen(port, () => {
    console.log(`AgentLens TS API listening on http://localhost:${port}`);
  });

  const shutdown = async () => {
    await sandboxRunner.stop();
    await realtimeManager.shutdown();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start AgentLens TS API', error);
  process.exit(1);
});
