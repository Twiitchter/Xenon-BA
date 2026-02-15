import React, { useState, useEffect, useCallback } from 'react';
import './DatabaseGate.css';

interface DatabaseGateProps {
  children: React.ReactNode;
}

const POLL_INTERVAL = 3000; // 3 seconds between retries

export default function DatabaseGate({ children }: DatabaseGateProps) {
  const [dbReady, setDbReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const checkDatabase = useCallback(async () => {
    try {
      const res = await fetch('/api/health/db');
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok' && data.database === 'connected') {
          setDbReady(true);
          setErrorMsg(null);
          return true;
        }
      }
      setErrorMsg('Database is not ready yet');
      return false;
    } catch {
      setErrorMsg('Server is not reachable');
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      const ready = await checkDatabase();
      if (!cancelled && !ready) {
        setAttempt((a) => a + 1);
        timeout = setTimeout(poll, POLL_INTERVAL);
      }
    };

    poll();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [checkDatabase]);

  if (dbReady) {
    return <>{children}</>;
  }

  return (
    <div className="db-gate-overlay">
      <div className="db-gate-card">
        <div className="db-gate-spinner">
          <svg viewBox="0 0 50 50" className="db-gate-spinner-svg">
            <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="db-gate-title">Connecting to Database</h2>
        <p className="db-gate-message">
          {errorMsg || 'Checking database connection...'}
        </p>
        {attempt > 0 && (
          <p className="db-gate-attempt">
            Retry attempt {attempt} &mdash; checking every {POLL_INTERVAL / 1000}s
          </p>
        )}
        <p className="db-gate-hint">
          The application will load automatically once the database is available.
        </p>
      </div>
    </div>
  );
}
