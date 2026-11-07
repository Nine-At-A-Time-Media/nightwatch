// POST /api/projects/:project/issues/:issue/assign -- a Member sets the Assignee.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../../../../../deps.js';
import { handleAssignIssue } from '../../../../../handlers/issues.js';

export default defineEventHandler((event) =>
  handleAssignIssue(
    toWebRequest(event),
    { project: getRouterParam(event, 'project') ?? '', issue: getRouterParam(event, 'issue') ?? '' },
    consoleDeps(bindingsOf(event.context)),
  ),
);
