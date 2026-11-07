// GET /api/report-form?project= -- the report form for the signed-in reporter.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../deps.js';
import { handleReportForm } from '../handlers/reports.js';

export default defineEventHandler((event) => handleReportForm(toWebRequest(event), consoleDeps(bindingsOf(event.context))));
