// POST /api/report -- the widget's filing endpoint (widget/README.md, HTTP contract).
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../deps.js';
import { handleFileReport } from '../handlers/reports.js';

export default defineEventHandler((event) => handleFileReport(toWebRequest(event), consoleDeps(bindingsOf(event.context))));
