// GET /api/follow-up/:reference -- the Follow-up View of a Report Reference.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../../deps.js';
import { handleViewFollowUp } from '../../handlers/reports.js';

export default defineEventHandler((event) =>
  handleViewFollowUp(toWebRequest(event), getRouterParam(event, 'reference') ?? '', consoleDeps(bindingsOf(event.context))),
);
