interface Env {
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  GOOGLE_DRIVE_FOLDER_ID: string;
}

function base64url(input: Uint8Array): string {
  let binary = '';
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(env: Env): Promise<string> {
  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (credentials.type !== 'service_account' || !credentials.private_key || !credentials.client_email) {
    throw new Error('Invalid service account credentials');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })));
  const pem = credentials.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const bytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`)));
  const assertion = `${header}.${payload}.${base64url(signature)}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error(`OAuth token request failed (${response.status})`);
  const data: { access_token?: string } = await response.json();
  if (!data.access_token) throw new Error('OAuth response missing access token');
  return data.access_token;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GOOGLE_DRIVE_FOLDER_ID) {
      return Response.json({ error: 'Google Drive configuration missing' }, { status: 503, headers });
    }
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) {
      return Response.json({ error: 'Invalid image ID' }, { status: 400, headers });
    }
    const token = await getAccessToken(env);
    const authorization = { Authorization: `Bearer ${token}` };
    const metaResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true`, { headers: authorization });
    if (!metaResponse.ok) throw new Error(`Drive metadata request failed (${metaResponse.status})`);
    const metadata: { mimeType?: string; parents?: string[]; trashed?: boolean } = await metaResponse.json();
    if (metadata.trashed || !metadata.parents?.includes(env.GOOGLE_DRIVE_FOLDER_ID) || !metadata.mimeType?.startsWith('image/')) {
      return Response.json({ error: 'Image not available in configured folder' }, { status: 404, headers });
    }
    const imageResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: authorization, redirect: 'follow' });
    if (!imageResponse.ok) throw new Error(`Drive image request failed (${imageResponse.status})`);
    const contentType = imageResponse.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) throw new Error(`Unexpected image content type: ${contentType.split(';')[0]}`);
    return new Response(imageResponse.body, {
      status: 200,
      headers: { 'Content-Type': metadata.mimeType, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    console.error('Poster image delivery failed:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'Unable to retrieve poster image' }, { status: 502, headers });
  }
};
