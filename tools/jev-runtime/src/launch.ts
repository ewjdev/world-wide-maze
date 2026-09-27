import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const env = resolve(root, '.env.jev');
if (existsSync(env)) process.loadEnvFile(env);
process.env.WWM_JEV_PILOT = '1';
process.env.WWM_JEV_PILOT_ID = process.env.WWM_JEV_PILOT_ID ?? 'local-pilot';
process.env.WWM_JEV_PORT = process.env.WWM_JEV_PORT ?? '5176';
const server = await createServer({
  root: resolve(root, 'apps/web'),
  configFile: resolve(root, 'apps/web/vite.config.ts'),
});
await server.listen();
console.info(`Jev spectator: http://127.0.0.1:${process.env.WWM_JEV_PORT}/dev/jev`);
console.info(`Archive: local/jev/${process.env.WWM_JEV_PILOT_ID} (retained across restarts)`);
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
