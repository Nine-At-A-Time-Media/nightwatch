/**
 * The scheduler Worker's entry point (architecture, Module map:
 * src/workers/scheduler): Cron Triggers only. Locally the trigger is fired
 * by hand (`pnpm dev:tick`), and by tests through this handler.
 */

import { schedulerRuntime, type SchedulerBindings } from './deps.js';
import { runScheduled } from './scheduler-steps.js';

export default {
  async scheduled(controller, env): Promise<void> {
    const run = await runScheduled(schedulerRuntime(env));
    console.log(
      JSON.stringify({
        event: 'scheduler.ran',
        cron: controller.cron,
        projects: run.expiries.size,
        failedProjects: run.failedProjects,
        overLimit: run.usage.filter((product) => product.over).map((product) => product.product),
      }),
    );
  },
} satisfies ExportedHandler<SchedulerBindings>;
