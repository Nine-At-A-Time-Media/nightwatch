// POST /api/projects/:project/issues/:issue/split -- a Member splits Fingerprints off into a new Issue.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../../../../../deps.js';
import { handleSplitIssue } from '../../../../../handlers/issues.js';

export default defineEventHandler((event) =>
  handleSplitIssue(
    toWebRequest(event),
    { project: getRouterParam(event, 'project') ?? '', issue: getRouterParam(event, 'issue') ?? '' },
    consoleDeps(bindingsOf(event.context)),
  ),
);
