// POST /api/projects/:project/issues/:issue/triage -- a Member resolves, archives, unarchives, unresolves, sets Priority or marks reviewed.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../../../../../deps.js';
import { handleTriageIssue } from '../../../../../handlers/issues.js';

export default defineEventHandler((event) =>
  handleTriageIssue(
    toWebRequest(event),
    { project: getRouterParam(event, 'project') ?? '', issue: getRouterParam(event, 'issue') ?? '' },
    consoleDeps(bindingsOf(event.context)),
  ),
);
