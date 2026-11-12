interface Env {
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  GOOGLE_DRIVE_FOLDER_ID: string;
}

type Context = { env: Env; request: Request };
type DriveFile = { id: string; name: string; mimeType: string };

const encoder = new TextEncoder();
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function accessToken(credentials: { client_email: string; private_key: string }): Promise<string> {
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(encoder.encode(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  const pem = credentials.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${header}.${payload}`)));
  const assertion = `${header}.${payload}.${base64url(signature)}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!response.ok) throw new Error(`Google authentication failed (${response.status})`);
  const result = await response.json() as { access_token: string };
  return result.access_token;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function getToken(env: Env): Promise<string> {
  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email: string; private_key: string };
  if (!credentials.client_email || !credentials.private_key) throw new Error('Incomplete service account credentials');
  return accessToken(credentials);
}

export const onRequestGet = async ({ env, request }: Context): Promise<Response> => {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GOOGLE_DRIVE_FOLDER_ID) {
    return json({ images: [], posters: [], error: 'Google Drive integration is not configured' }, 503);
  }
  try {
    const token = await getToken(env);
    const url = new URL(request.url);
    const imageId = url.searchParams.get('image');
    if (imageId) {
      // Only serve images actually present in the configured folder.
      const listing = await listImages(env.GOOGLE_DRIVE_FOLDER_ID, token);
      if (!listing.some(file => file.id === imageId)) return new Response('Not found', { status: 404 });
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(imageId)}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) return new Response('Google Drive image unavailable', { status: 502 });
      return new Response(response.body, {
        headers: { 'Content-Type': response.headers.get('Content-Type') || 'image/png', 'Cache-Control': 'private, max-age=30', 'X-Content-Type-Options': 'nosniff' }
      });
    }
    const files = await listImages(env.GOOGLE_DRIVE_FOLDER_ID, token);
    const images = files.map(file => ({
      id: file.id,
      name: file.name,
      url: `/api/posters?image=${encodeURIComponent(file.id)}`
    }));
    return json({ images, posters: images, folderId: env.GOOGLE_DRIVE_FOLDER_ID });
  } catch (error) {
    console.error('Poster API error', error instanceof Error ? error.message : 'Unknown error');
    return json({ images: [], posters: [], error: 'Unable to retrieve Google Drive posters' }, 502);
  }
};

async function listImages(folderId: string, token: string): Promise<DriveFile[]> {
  const query = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and (mimeType = 'image/png' or mimeType = 'image/jpeg' or mimeType = 'image/webp' or mimeType = 'image/gif')`;
  const params = new URLSearchParams({ q: query, fields: 'nextPageToken,files(id,name,mimeType)', pageSize: '100' });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Google Drive listing failed (${response.status})`);
  const data = await response.json() as { files?: DriveFile[] };
  return (data.files || []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
