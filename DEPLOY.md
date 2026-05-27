# Deployment

This app is a Node/Express web service that stores uploaded JPEG files on disk.
Use a host that supports persistent storage. Render is the simplest fit for this
project because `render.yaml` can define the web service, environment variables,
and persistent disk together.

## Render Setup

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from the repository.
3. When prompted, set `ACCESS_PASSWORD` to the shared password for your team.
4. Keep the generated `ACCESS_SECRET` value.
5. Deploy the service.
6. Share the Render URL with your team.

## Important Settings

- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`
- Persistent data directory: `/var/data`
- Required environment variable: `ACCESS_PASSWORD`
- Recommended environment variable: `ACCESS_SECRET`

Uploaded manuscripts are saved under `DATA_DIR`. On Render, `render.yaml` maps
that to `/var/data`, which is backed by a persistent disk.

## Local Password Test

PowerShell:

```powershell
$env:ACCESS_PASSWORD="preview-pass"
npm start
```

Open `http://localhost:3000`. You should see the password screen first.

## Notes

- This is shared-password protection, not per-user login.
- Anyone who knows the URL and password can access uploaded manuscripts.
- Change `ACCESS_PASSWORD` in Render when a member should no longer have access.
- Do not deploy this without a persistent disk unless losing uploaded JPEGs on
  restart/redeploy is acceptable.
