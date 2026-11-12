interface Env {
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  GOOGLE_DRIVE_FOLDER_ID: string;
}

type Context = { env: Env };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function base64url(input: Uint8Array): string {
  let binary = '';
  for (const b of input) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function privateKeyBytes(pem: string): Uint8Array {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

async function checkedJson(url: string, init: RequestInit, stage: string): Promise<any> {
  const response = await fetch(url, { ...init, redirect: 'manual' });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.toLowerCase().includes('application/json')) {
    console.error('Poster upstream failure', { stage, status: response.status, contentType, redirected: response.status >= 300 && response.status < 400 });
    throw new Error(`${stage}: upstream HTTP ${response.status}, content type ${contentType || 'missing'}`);
  }
  try { return await response.json(); }
  catch { throw new Error(`${stage}: invalid JSON response`); }
}

async function accessToken(credentials: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3500,
  })));
  const key = await crypto.subtle.importKey('pkcs8', privateKeyBytes(credentials.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`)));
  const assertion = `${header}.${payload}.${base64url(signature)}`;
  const data = await checkedJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  }, 'oauth_token');
  if (!data.access_token) throw new Error(`oauth_token: ${String(data.error || 'missing access token')}`);
  return data.access_token;
}

export const onRequestGet = async ({ env }: Context): Promise<Response> => {
  try {
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GOOGLE_DRIVE_FOLDER_ID) {
      return json({ images: [], posters: [], error: 'Missing Cloudflare configuration', stage: 'configuration' }, 503);
    }
    let credentials: { client_email: string; private_key: string };
    try { credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON); }
    catch { return json({ images: [], posters: [], error: 'Service account secret is not valid JSON', stage: 'configuration' }, 503); }
    if (!credentials.client_email || !credentials.private_key) {
      return json({ images: [], posters: [], error: 'Service account credentials incomplete', stage: 'configuration' }, 503);
    }
    const token = await accessToken(credentials);
    const query = `'${env.GOOGLE_DRIVE_FOLDER_ID.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType contains 'image/'`;
    const params = new URLSearchParams({ q: query, fields: 'nextPageToken,files(id,name,mimeType)', page_size: '100' });
    // Drive API expects pageSize (camelCase).
    params.delete('page_size');
    params.set('pageSize', '100');
    const data = await checkedJson(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { authorization: `Bearer ${token}` },
    }, 'drive_list');
    if (data.error) throw new Error(`drive_list: ${String(data.error.status || 'API error')}`);
    const files = (Array.isArray(data.files) ? data.files : []).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
    const images = files.map((f: any) => ({ id: f.id, name: f.name, url: `/api/poster-image?id=${encodeURIComponent(f.id)}` }));
    return json({ images, posters: images });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown failure';
    const stage = message.split(':')[0];
    console.error('Poster API diagnostic', { stage, message });
    return json({ images: [], posters: [], error: 'Unable to retrieve Google Drive posters', stage, detail: message }, 502);
  }
};
