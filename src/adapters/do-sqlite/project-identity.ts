/**
 * Which Project a ProjectDO holds, and when it sweeps next. A ProjectDO id is
 * derived from its Project id, but the object cannot read that name back, so
 * the first call records the Project it names; a later call naming another
 * Project is refused by throwing, since it can only be a wiring fault
 * (architecture Security mitigations: Cross-tenant). The sweep alarm is the
 * object's one alarm.
 */

const SCHEMA = `CREATE TABLE IF NOT EXISTS project_identity (project_id TEXT NOT NULL)`;

// --- actions ---

/** The Project this object holds, or null before any call named one. */
export function claimedProject(sql: SqlStorage): string | null {
  sql.exec(SCHEMA);
  const row = sql.exec('SELECT project_id FROM project_identity LIMIT 1').toArray()[0];
  const projectId = row?.['project_id'];
  return typeof projectId === 'string' ? projectId : null;
}

/** Records the Project on the first call; true when this call was the first. Throws for another Project. */
export function claimProject(sql: SqlStorage, projectId: string): boolean {
  const held = claimedProject(sql);
  if (held === projectId) return false;
  if (held !== null) throw new Error(`this object holds project ${held}, not project ${projectId}`);
  sql.exec('INSERT INTO project_identity (project_id) VALUES (?)', projectId);
  return true;
}

export async function scheduleSweep(storage: DurableObjectStorage, at: number): Promise<void> {
  await storage.setAlarm(at);
}
