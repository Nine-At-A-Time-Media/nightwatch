// POST /api/projects/:project/issues/:issue/github -- a Member opens a GitHub issue from the Issue.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps, trackerDeps } from '../../../../../deps.js';
import { handleOpenExternalIssue } from '../../../../../handlers/issues.js';

export default defineEventHandler((event) =>
  handleOpenExternalIssue(
    toWebRequest(event),
    { project: getRouterParam(event, 'project') ?? '', issue: getRouterParam(event, 'issue') ?? '' },
    trackerDeps(consoleDeps(bindingsOf(event.context))),
  ),
);
