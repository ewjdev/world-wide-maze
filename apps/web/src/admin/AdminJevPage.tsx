import { useEffect, useState } from 'react';
import JevPage from '../jev/JevPage.tsx';
import { adminRequest, errorMessage } from './api.ts';

export default function AdminJevPage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void adminRequest('/session', { signal: abort.signal })
      .then(() => setReady(true))
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorMessage(e));
      });
    return () => abort.abort();
  }, []);
  if (ready) return <JevPage admin />;
  return (
    <main style={{ padding: 32 }}>
      <h1>Jev administration</h1>
      <p role={error ? 'alert' : 'status'}>{error || 'Checking operator session…'}</p>
      <a href="/admin">Back to administration</a>
    </main>
  );
}
