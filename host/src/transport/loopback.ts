export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

export function assertLoopbackHost(host: string) {
  if (!isLoopbackHost(host)) {
    throw new Error('Iris HTTP transport must bind to a loopback address');
  }
}
