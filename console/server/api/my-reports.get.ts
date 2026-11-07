// GET /api/my-reports -- the signed-in reporter's own Reports.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../deps.js';
import { handleListMyReports } from '../handlers/reports.js';

export default defineEventHandler((event) => handleListMyReports(toWebRequest(event), consoleDeps(bindingsOf(event.context))));
