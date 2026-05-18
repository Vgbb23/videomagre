import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'af_url_tracking_qs';

type UrlTrackingContextValue = {
  /** Query string incluindo `?`, ou string vazia */
  queryString: string;
  /** Pares chave/valor da query atual (para enviar à API) */
  trackingParams: Record<string, string>;
  /** Monta URL relativa mantendo a query (ex.: `hrefWithParams('#ofertas')`) */
  hrefWithParams: (hashOrPath: string) => string;
};

const UrlTrackingContext = createContext<UrlTrackingContextValue | null>(null);

function initialQueryString(): string {
  if (typeof window === 'undefined') return '';
  return window.location.search || '';
}

export function UrlTrackingProvider({ children }: { children: ReactNode }) {
  const [queryString, setQueryString] = useState(initialQueryString);

  useEffect(() => {
    const incoming = window.location.search || '';
    if (incoming.length > 1) {
      sessionStorage.setItem(STORAGE_KEY, incoming);
      setQueryString(incoming);
      return;
    }
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved && saved.length > 1) {
      const next = `${window.location.pathname}${saved}${window.location.hash}`;
      window.history.replaceState(null, '', next);
      setQueryString(saved);
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      const s = window.location.search || '';
      if (s.length > 1) sessionStorage.setItem(STORAGE_KEY, s);
      setQueryString(s.length > 1 ? s : sessionStorage.getItem(STORAGE_KEY) || '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const trackingParams = useMemo(() => {
    const raw = queryString.startsWith('?') ? queryString.slice(1) : queryString;
    const params = new URLSearchParams(raw);
    const out: Record<string, string> = {};
    params.forEach((v, k) => {
      if (k) out[k] = v;
    });
    return out;
  }, [queryString]);

  const hrefWithParams = useCallback(
    (hashOrPath: string) => {
      const path = window.location.pathname || '/';
      const qs = queryString || '';
      if (!hashOrPath || hashOrPath === '#') {
        return `${path}${qs}#`;
      }
      if (hashOrPath.startsWith('#')) {
        return `${path}${qs}${hashOrPath}`;
      }
      if (hashOrPath.startsWith('http://') || hashOrPath.startsWith('https://')) {
        return hashOrPath;
      }
      if (hashOrPath.startsWith('/')) {
        const hashIdx = hashOrPath.indexOf('#');
        if (hashIdx === -1) return `${hashOrPath.split('?')[0]}${qs}`;
        const base = hashOrPath.slice(0, hashIdx);
        const hash = hashOrPath.slice(hashIdx);
        return `${base.split('?')[0]}${qs}${hash}`;
      }
      return `${path}${qs}#${hashOrPath.replace(/^#/, '')}`;
    },
    [queryString],
  );

  const value = useMemo(
    () => ({
      queryString,
      trackingParams,
      hrefWithParams,
    }),
    [queryString, trackingParams, hrefWithParams],
  );

  return <UrlTrackingContext.Provider value={value}>{children}</UrlTrackingContext.Provider>;
}

export function useUrlTracking(): UrlTrackingContextValue {
  const ctx = useContext(UrlTrackingContext);
  if (!ctx) {
    throw new Error('useUrlTracking deve ser usado dentro de UrlTrackingProvider');
  }
  return ctx;
}
