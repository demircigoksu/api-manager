import { Router } from 'express';
import type { Request, Response } from 'express';
import { getSyncState, setCatalogSyncEnabled, syncCatalog } from '../services/catalog-sync.js';

// Model catalog sync (Api Manager fork). Replaces the upstream /api/premium
// routes: no license keys, no billing; just the state of the free monthly
// catalog, an on/off switch and a manual "check now".
export const catalogRouter = Router();

/** GET /api/catalog — sync state and whether it is enabled. */
catalogRouter.get('/', (_req: Request, res: Response) => {
  res.json(getSyncState());
});

/** PUT /api/catalog { enabled } — turn the network sync on or off. */
catalogRouter.put('/', (req: Request, res: Response) => {
  if (typeof req.body?.enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled must be a boolean' } });
    return;
  }
  setCatalogSyncEnabled(req.body.enabled);
  res.json(getSyncState());
});

/** POST /api/catalog/sync — check for a newer catalog now. */
catalogRouter.post('/sync', async (_req: Request, res: Response) => {
  const sync = await syncCatalog(true);
  res.json({ ...getSyncState(), sync });
});
