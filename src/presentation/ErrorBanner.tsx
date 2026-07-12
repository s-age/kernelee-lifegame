// presentation/ErrorBanner.tsx — display of useKernelError() only.
//
// Ring rule: presentation depends only on contract + react-kernelee.
// Hidden when null. No close button (minimal).

import type { ReactElement } from 'react';
import { useKernelError } from '@s-age/react-kernelee';

export function ErrorBanner(): ReactElement | null {
  const message = useKernelError();
  if (message === null) return null;

  return (
    <div className="error-banner" role="alert">
      {message}
    </div>
  );
}
