// Only a definite "signed out" sends a visitor away. If the worker is down, riders still get the map.
export async function signedOut(endpoint: string, fetchImpl: typeof fetch = fetch) {
  try {return (await fetchImpl(endpoint, {cache: 'no-store', signal: AbortSignal.timeout(5000)})).status === 401;}
  catch {return false;}
}
