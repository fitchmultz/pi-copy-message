export function probeLocal(_name: string, fn: () => void): Promise<void> {
  fn();
  return Promise.resolve();
}

export function test(_name: string, fn: () => void): Promise<void> {
  fn();
  return Promise.resolve();
}

export async function probeHelper(): Promise<void> {
  // An ordinary asynchronous call.
}
