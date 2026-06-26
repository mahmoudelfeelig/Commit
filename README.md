# Commit

Commit is a browser-based GitHub contribution graph designer. Draw the exact shape you want, manage multiple years, and copy a git command when you're done.

The site is static and is currently hosted on `commit.elfeel.me`.

## Run locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` in your browser.

## Run on the website

You can alternatively go on `https://commit.elfeel.me` and use the app directly in your browser.

## What it does

- Paints contribution cells directly in the browser
- Lets you add single years or whole ranges
- Exports a shell snippet of `git commit` commands
- Keeps the design in your browser with `localStorage`

## Local commit runner

`main.py` is still included for people who want to apply the same shapes in a local repository. The browser app now generates direct `git commit` commands for copying.
