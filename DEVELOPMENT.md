# Working on the website

Plain HTML and CSS. Edit the files directly; there is no build step.

- `index.html` — homepage
- `support.html` — help and GitHub Issues
- `privacy.html` — privacy policy
- `assets/` — styles, favicon and signal illustration
- `.github/ISSUE_TEMPLATE/` — bug reports and ideas

## Local preview

```sh
python3 -m http.server 8766 --bind 127.0.0.1
```

Open http://127.0.0.1:8766/. Stop with Ctrl-C.

## GitHub Pages

Settings → Pages → Deploy from a branch → **main**, **/ (root)**.

The site address is `https://kirilenkobm.github.io/gleitzsch-site/` once Pages is enabled. Support and privacy live at `support.html` and `privacy.html` under that address.

If the repository name or domain changes, update the base path in `404.html`.

## Still to add

- A public TestFlight or App Store link.
- Real photographs made with the app to accompany the signal illustration.
- An email address for private support requests.
- Donation and social links when those accounts exist.
