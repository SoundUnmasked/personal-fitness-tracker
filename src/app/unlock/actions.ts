'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  AUTH_COOKIE,
  AUTH_COOKIE_MAX_AGE,
  authCookieValue,
  isAuthConfigured,
  verifyPassphrase,
} from '@/lib/auth';

/**
 * Handle the /unlock form. On the correct passphrase, set the signed auth
 * cookie (1 year, httpOnly, secure in prod, sameSite=lax) and go home; on a
 * wrong one, bounce back to /unlock with an error flag — no JS required.
 */
export async function unlockAction(formData: FormData): Promise<void> {
  if (!isAuthConfigured()) redirect('/unlock?error=unconfigured');

  const passphrase = String(formData.get('passphrase') ?? '');
  if (!verifyPassphrase(passphrase)) redirect('/unlock?error=1');

  (await cookies()).set(AUTH_COOKIE, authCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  redirect('/');
}
