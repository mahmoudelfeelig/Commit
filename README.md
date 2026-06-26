# Imprint

Imprint is a browser-based GitHub contribution graph designer. Draw the exact shape you want, manage multiple years, and copy a commit command when you're done.

The site is static. You can host it on `imprint.elfeel.me` or any other static host, then point a wildcard subdomain like `name.elfeel.me` at the same app.

## Run locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` in your browser.

## What it does

- Paints contribution cells directly in the browser
- Lets you add single years or whole ranges
- Exports a command like `python3 main.py --shape ...`
- Keeps the design in your browser with `localStorage`

## Local commit runner

`main.py` is still included for people who want to apply the generated command in a local repository. It accepts the same shape tokens that Imprint generates.

## Deployment

Because this is a static app, you can deploy it with:

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel static hosting
- Any Nginx or Apache setup that serves `index.html`

If you want `name.elfeel.me` to all point at the same app, configure a wildcard DNS record for `*.elfeel.me` and route every subdomain to the same hosted build.
