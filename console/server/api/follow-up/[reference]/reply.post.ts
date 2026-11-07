// POST /api/follow-up/:reference/reply -- the reporter replies in the Thread.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../../../deps.js';
import { handleReplyAsReporter } from '../../../handlers/reports.js';

export default defineEventHandler((event) =>
  handleReplyAsReporter(toWebRequest(event), getRouterParam(event, 'reference') ?? '', consoleDeps(bindingsOf(event.context))),
);
