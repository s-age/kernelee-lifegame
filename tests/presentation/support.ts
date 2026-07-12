// Test-only polling helper — mirrors react-kernelee's own tests/support.ts
// idiom: `Circuit.Sim.play` dispatches onto the serial CommandBus and its
// tick loop runs as a fire-and-forget Task, so a test observing
// `LoopState.phase` flip has no promise to `await` — it polls.

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 1000; i += 1) {
    if (condition()) return;
    await sleep(1);
  }
  throw new Error('condition never held');
}
