/**
 * Phase 14 routes, spread into `src/routes.tsx` with one line. `/play/local` outranks `/play/:stageId` (a
 * static segment wins in React Router), so the receiver never reaches the stage-id resolver.
 */
import type { RouteObject } from 'react-router';

export const localCaptureRoutes: RouteObject[] = [
  { path: '/play/local', lazy: async () => ({ Component: (await import('./LocalPlayPage.tsx')).default }) },
  { path: '/mazify', lazy: async () => ({ Component: (await import('./MazifyPage.tsx')).default }) },
];
