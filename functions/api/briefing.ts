
interface Env {
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  GOOGLE_DRIVE_FOLDER_ID: string;
}

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(credentials: {
  client_email: string;
  private_key: string;
  token_uri?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = "https://oauth2.googleapis.com/token";

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));

  const pem = credentials.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google authentication failed: ${response.status}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GOOGLE_DRIVE_FOLDER_ID) {
      throw new Error("Google Drive configuration missing");
    }

    const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const accessToken = await getAccessToken(credentials);

    const query = `'${env.GOOGLE_DRIVE_FOLDER_ID}' in parents and name = 'briefing.json' and trashed = false`;

    const searchUrl = new URL("https://www.googleapis.com/drive/v3/files");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("fields", "files(id,name,mimeType),nextPageToken");
    searchUrl.searchParams.set("page_size", "100");

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!searchResponse.ok) {
      throw new Error(`Google Drive listing failed: ${searchResponse.status}`);
    }

    const result = await searchResponse.json() as {
      files?: Array<{ id: string; name: string }>;
    };

    const file = result.files?.find(f => f.name === "briefing.json");

    if (!file) {
      throw new Error("briefing.json not found in Google Drive folder");
    }

    const fileResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!fileResponse.ok) {
      throw new Error(`Briefing download failed: ${fileResponse.status}`);
    }

    const briefing = await fileResponse.json();

    return new Response(JSON.stringify(briefing), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("Briefing API error", error);
    return new Response(JSON.stringify({
      error: "Unable to load briefing",
      stage: "google_drive",
    }), {
      status: 502,
      headers: jsonHeaders,
    });
  }
};
