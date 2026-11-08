// GET /api/projects/:project/issues?query=&cursor= -- Issue search for a Member.
// Entry point: builds the deps from the request's bindings and calls one handler.
import { bindingsOf, consoleDeps } from '../../../../deps.js';
import { handleSearchIssues } from '../../../../handlers/issues.js';

export default defineEventHandler((event) =>
  handleSearchIssues(toWebRequest(event), getRouterParam(event, 'project') ?? '', consoleDeps(bindingsOf(event.context))),
);
