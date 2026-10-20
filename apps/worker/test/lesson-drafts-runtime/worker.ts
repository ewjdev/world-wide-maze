// Test-only entrypoint. Never referenced by the deployed Worker configuration. The admin router's Access check is
// replaced by a fixed operator, so the test exercises everything behind it.
import { Hono } from 'hono';
import { lessonDraftRoutes } from '../../src/lesson-drafts/routes.ts';
import type { AdminEnv } from '../../src/routes/admin.ts';

export { LessonDraftAgent } from '../../src/lesson-drafts/agent.ts';
export { LessonDraftWorkflow } from '../../src/lesson-drafts/workflow.ts';
export { Limiter } from '../../src/limiter.ts';

const app = new Hono<AdminEnv>();
app.use('*', async (c, next) => {
  c.set('adminEmail', 'operator@example.com');
  await next();
});
app.route('/api/admin/lessons', lessonDraftRoutes);
export default app;
