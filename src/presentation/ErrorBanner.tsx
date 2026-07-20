// presentation/ErrorBanner.tsx — display of useKernelError(), with a dismiss
// affordance that clears it.
//
// Ring rule: presentation depends only on contract + react-kernelee.
// Hidden when null. useKernelError() only reads; dismiss dispatches
// Circuit.Faults.clearError (contract) — the handler side mutates
// KernelErrorState back to { message: null } (circuit/faults/kernelError.mutator.ts).

import type { ReactElement } from 'react';
import { useDispatch, useKernelError } from '@s-age/react-kernelee';
import { FaultsActions } from '../contract/ports';

export function ErrorBanner(): ReactElement | null {
  const message = useKernelError();
  const dispatch = useDispatch();
  if (message === null) return null;

  return (
    <div className="error-banner" role="alert">
      {message}
      <button type="button" aria-label="dismiss" onClick={() => dispatch(FaultsActions.clearError())}>
        ×
      </button>
    </div>
  );
}
