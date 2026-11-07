// The monitors Worker as the integration-monitors project runs it: its own
// entry point, plus ProjectDO hosted beside it, since the plugin cannot bind
// a Durable Object of another script without a pre-bundled auxiliary Worker.
export { default, MetricRuleDO, MonitorDO } from '../../../src/workers/monitors/index.js';
export { ProjectDO } from '../../../src/workers/core/project-do.js';
