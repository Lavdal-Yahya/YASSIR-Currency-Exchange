import { useEffect, useState } from 'react';

// Subscribes to navigator.onLine transitions. Bootstraps from the
// current status so a component mounting during an offline session
// immediately shows the banner rather than waiting for the next event.
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    function up() {
      setOnline(true);
    }
    function down() {
      setOnline(false);
    }
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
