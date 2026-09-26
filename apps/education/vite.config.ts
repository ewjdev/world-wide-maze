import { fileURLToPath } from 'node:url';
import { baselinePath } from '@wwm/learning';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rolldownOptions: {
      input: [
        fileURLToPath(new URL('./index.html', import.meta.url)),
        ...baselinePath.activities.map((activity) =>
          fileURLToPath(new URL(`./lessons/${activity.id}/index.html`, import.meta.url)),
        ),
      ],
    },
  },
  server: { strictPort: true },
});
