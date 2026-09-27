import { createHash } from 'node:crypto';
import { canonical } from '../../../packages/maze-agent/src/contracts.ts';
export const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
