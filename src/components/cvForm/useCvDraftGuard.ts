import { useEffect, useRef, useState } from 'react';

import { CV_FORM_LEAVE } from '../../api/structuredCv';

/**
 * Aviso de rascunho: beforeunload, clique em link interno e volta do histórico.
 * Não grava o currículo em lugar nenhum.
 */
export function useCvDraftGuard(active: boolean) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const skipping = useRef(false);

  useEffect(() => {
    if (!active) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest('a');
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) {
        return;
      }
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) {
        return;
      }
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) {
        return;
      }
      const next = `${url.pathname}${url.search}${url.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next === current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(next);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }
    window.history.pushState({ maeCvDraft: true }, '');
    const onPop = () => {
      if (skipping.current) {
        return;
      }
      setPendingHref((current) => current ?? 'back');
      window.history.pushState({ maeCvDraft: true }, '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [active]);

  return {
    message: pendingHref ? CV_FORM_LEAVE : null,
    pendingHref,
    stay() {
      setPendingHref(null);
    },
    takeLeave(): string | null {
      const href = pendingHref;
      skipping.current = true;
      setPendingHref(null);
      return href;
    },
  };
}
