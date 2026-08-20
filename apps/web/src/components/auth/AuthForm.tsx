'use client';

import { useActionState, useState } from 'react';
import { signIn, signUp, type FormResult } from '@/lib/actions/auth';
import { SubmitButton } from '../SubmitButton';

/**
 * Sign-in and sign-up.
 *
 * The password rules are shown up front rather than only after a rejection, and the server's
 * answer is rendered verbatim — a failed attempt never looks like a success.
 */
export function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
  const action = mode === 'signup' ? signUp : signIn;
  const [state, formAction] = useActionState<FormResult | null, FormData>(action, null);
  const [password, setPassword] = useState('');

  return (
    <form action={formAction} className="col g14">
      {mode === 'signup' ? (
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" name="name" className="input" autoComplete="name" maxLength={120} />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete={mode === 'signup' ? 'email' : 'username'}
          required
          maxLength={200}
          aria-invalid={state?.error ? true : undefined}
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={mode === 'signup' ? 'pw-help' : undefined}
        />
        {mode === 'signup' ? (
          <p id="pw-help" className="faint xs" style={{ margin: 0 }}>
            At least 10 characters, with a letter and a number.
          </p>
        ) : null}
        {state?.fieldErrors?.password ? (
          <p className="xs" role="alert" style={{ margin: 0, color: 'var(--crit)' }}>
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      {mode === 'signup' ? (
        <div className="field">
          <label htmlFor="workspaceName">Workspace name</label>
          <input
            id="workspaceName"
            name="workspaceName"
            className="input"
            placeholder="Acme GTM"
            maxLength={120}
          />
          <p className="faint xs" style={{ margin: 0 }}>
            Optional. You can rename it or create more later.
          </p>
        </div>
      ) : null}

      {state?.error ? (
        <p className="note note--crit sm" role="alert" style={{ margin: 0 }}>
          {state.error}
        </p>
      ) : null}

      <SubmitButton className="btn btn--pri btn--block" pendingLabel="Please wait…">
        {mode === 'signup' ? 'Create account' : 'Sign in'}
      </SubmitButton>
    </form>
  );
}
