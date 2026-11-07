// POST /api/projects/:project/issues/:issue/comments -- a Member comments, shared or private.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../../../../../deps.js';
import { handleAddComment } from '../../../../../handlers/issues.js';

export default defineEventHandler((event) =>
  handleAddComment(
    toWebRequest(event),
    { project: getRouterParam(event, 'project') ?? '', issue: getRouterParam(event, 'issue') ?? '' },
    consoleDeps(bindingsOf(event.context)),
  ),
);
