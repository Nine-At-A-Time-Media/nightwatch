// POST /api/projects/:project/issues/:issue/merge -- a Member merges source Issues into this one.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../../../../../deps.js';
import { handleMergeIssues } from '../../../../../handlers/issues.js';

export default defineEventHandler((event) =>
  handleMergeIssues(
    toWebRequest(event),
    { project: getRouterParam(event, 'project') ?? '', issue: getRouterParam(event, 'issue') ?? '' },
    consoleDeps(bindingsOf(event.context)),
  ),
);
