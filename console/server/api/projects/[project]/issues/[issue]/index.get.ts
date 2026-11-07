// GET /api/projects/:project/issues/:issue -- one Issue for a Member.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../../../../../deps.js';
import { handleViewIssue } from '../../../../../handlers/issues.js';

export default defineEventHandler((event) =>
  handleViewIssue(
    toWebRequest(event),
    { project: getRouterParam(event, 'project') ?? '', issue: getRouterParam(event, 'issue') ?? '' },
    consoleDeps(bindingsOf(event.context)),
  ),
);
