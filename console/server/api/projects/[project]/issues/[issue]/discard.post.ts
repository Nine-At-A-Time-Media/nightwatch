// POST /api/projects/:project/issues/:issue/discard -- a Member discards the Issue.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../../../../../deps.js';
import { handleDiscardIssue } from '../../../../../handlers/issues.js';

export default defineEventHandler((event) =>
  handleDiscardIssue(
    toWebRequest(event),
    { project: getRouterParam(event, 'project') ?? '', issue: getRouterParam(event, 'issue') ?? '' },
    consoleDeps(bindingsOf(event.context)),
  ),
);
