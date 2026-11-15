# Netlify setup for TMDB posters

## Project layout
```
index.html  style.css  app.js
netlify.toml
netlify/functions/tmdb-search.mjs
assets/tmdb-logo.svg        <- you add this (see step 6)
.gitignore
```

## Steps
1. Get a TMDB token: create a free account at themoviedb.org, open Settings > API, request an API key, and copy the **API Read Access Token** (the long one, not the short API key).
2. Put the whole project in a Git repository (GitHub, GitLab or Bitbucket). `netlify.toml` must sit in the repository root.
3. In Netlify choose **Add new site > Import an existing project**, pick the repository. Leave the build command empty. Publish directory `.` and functions directory `netlify/functions` come from `netlify.toml`.
   - A drag-and-drop folder upload ("Netlify Drop") does NOT deploy functions. Use Git or the Netlify CLI (`netlify deploy --prod`).
4. In **Site configuration > Environment variables** add `TMDB_READ_ACCESS_TOKEN` with your read access token. Mark it secret if offered.
5. **Redeploy** (Deploys > Trigger deploy > Deploy site). Variables only apply to new deploys.
6. Download the official TMDB logo from themoviedb.org/about/logos-attribution, save it unmodified as `assets/tmdb-logo.svg` (rename if you pick another format and update the path in `app.js`). Until it exists, Settings shows the text "TMDB" instead.
7. Check: open `https://YOUR-SITE.netlify.app/api/tmdb-search?title=Zootopia`. You should see JSON results. `{"error":"not_configured"}` means the variable is missing or the site was not redeployed.

For local testing use `netlify dev` with the token in a local `.env` file (already in `.gitignore`).

## Testing checklist
- Online search: Settings > Thumbnail Manager > Fetch poster shows real TMDB candidates with artwork, title and year; nothing is pre-selected.
- Selecting a candidate saves the poster; the movie card, hero and Settings row show it; "Change poster" replaces it.
- Movie with no poster result: candidate is disabled and shows the crown.
- Offline (turn network off): Fetch poster shows a clear message; cards keep the crown; already cached posters still show.
- Not configured / wrong token: the message names TMDB_READ_ACCESS_TOKEN.
- Poster caching: reload the page; posters remain. Settings > Clear poster cache returns to crowns.
- Title cleaning: add files named like the examples; check title, year, and that the Files section still shows the original filename.
- File selection: Add files accepts any file type; non-video files appear only in Files; unreadable videos show "Not readable here".
- Folder: Add folder; in Chrome-based desktop browsers reopen later and use "Reopen saved folders". Elsewhere Settings explains you must pick the folder again.
- Playback: play, pause, seek, volume, speed, fullscreen, previous/next, .srt/.vtt sidecar, Escape/Backspace closes, controls hide while playing, mouse movement does not move focus.
- Errors: an MKV/HEVC file the browser cannot decode shows the codec message.
- Confirm the token never appears in page source, network responses or storage.
