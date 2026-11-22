import { auth } from '../firebase';

/**
 * Wrapper around fetch() that attaches the current user's Firebase ID token
 * in the Authorization: Bearer <token> header for authenticated backend API calls.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers || {});

  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }
  } catch (err) {
    console.warn('[authFetch] Unable to retrieve Firebase ID token:', err);
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

export async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}
