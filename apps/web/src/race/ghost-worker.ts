import { type RaceAttempt, type RaceCourse, replayRace } from '@wwm/race';

self.onmessage = async (event: MessageEvent<{ course: RaceCourse; attempt: RaceAttempt }>) => {
  try {
    const track = await replayRace(event.data.course, event.data.attempt);
    self.postMessage(
      { track },
      { transfer: [track.pos.buffer, track.quat.buffer, track.discontinuities.buffer] },
    );
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Ghost preparation failed' });
  }
};
