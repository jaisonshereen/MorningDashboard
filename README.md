# MorningDashboard

Responsive private dashboard for Cloudflare Pages. Includes a news ticker, a YouTube sequential loop, poster gallery, meeting and task widgets, settings, and 30-second polling.

## Deploy manually (no Work credits)

1. Create or open the GitHub repository `jaisonshereen/MorningDashboard`.
2. Upload the contents of this project folder to the repository root (not the containing folder). Do **not** upload `.env` secrets.
3. In Cloudflare dashboard > Workers & Pages > Create application > Pages > Connect to Git, select `MorningDashboard`.
4. Build command: `npm run build`; output directory: `dist`; root directory: `/`; framework preset: `Vite` (or None).
5. Deploy. Cloudflare Pages will build the React frontend and deploy the Pages Functions in `functions/api`.
6. **Before putting private information in the site**, set up Cloudflare Zero Trust > Access > Applications > Add application > Self-hosted, covering the Pages hostname or custom domain, with an Allow policy limited to your email. Verify in an incognito browser that login is enforced. For `*.pages.dev` hostnames, ensure the Access application covers the actual deployment URLs, including preview URLs, or disable previews. Protect `/api/*` as well.
7. In Cloudflare Pages > Settings > Variables and Secrets, set `DRIVE_FOLDER_ID` and one of `BRIEFING_JSON` or `BRIEFING_URL` + secret `BRIEFING_TOKEN`. Redeploy after changes.

## Briefing API format

`GET /api/briefing` returns JSON:

```json
{
  "updatedAt": "2026-11-12T08:30:00+05:30",
  "headlines": ["Your top priority today", "Meeting at 3 PM"],
  "meetings": [{"title":"Team sync", "detail":"3:00 PM IST"}],
  "tasks": [{"title":"SCRUM-250", "detail":"High priority"}],
  "sections": [{"title":"Weather", "items":["Connect a weather source"]}]
}
```

The existing ChatGPT scheduled Morning Daily Dashboard cannot be accessed by this website automatically. Have your Oracle Node-RED flow produce the JSON above and expose a **secure HTTPS** endpoint, or set `BRIEFING_JSON` manually. Never put credentials in the frontend. Node-RED should validate bearer tokens and avoid logging sensitive values. The frontend polls every 30 seconds; upstream updates depend on the source.

## Google Drive posters

The configured folder ID is `1MedrJbd1vWM7tSTu4wSXzrKrlbtwM7N-`. The starter Pages Function supports Drive API listing with an API key only for **publicly readable** image files. It intentionally does not make a private folder public. For private Drive images, implement Google OAuth or a service account with folder access, proxy images through authenticated Pages Functions, and keep credentials in Cloudflare secrets. Google thumbnail URLs may expire or require authentication; this starter does not guarantee private Drive playback. Without a configured connector the widget shows a placeholder.

## YouTube

Default playlist: `TIC0J0c70m8`, `InNt79NVuRQ`, `5sbvNtEyFPU`. Playback uses YouTube's iframe API state notifications and advances on video end. The user must click Start once; browser/TV autoplay, video embedding permissions, and YouTube error behavior vary. Some TVs may not support the embedded player reliably. If a video cannot embed, use Next video.

## Settings and security

Widget toggles, ticker duration and playlist URLs are saved to localStorage per device; they do not sync across devices. The Cloudflare Access policy must be configured before using real personal data. The app itself does **not** implement authentication. Avoid sharing the deployment URL until Access is active. No personal Gmail, Jira or Google tokens should be put into the source code.

## Local build (optional)

`npm install && npm run build`.
