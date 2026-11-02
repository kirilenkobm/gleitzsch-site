# Gleitzsch — project website

Buildless, English-language static site for the Gleitzsch iPhone art camera. The app source stays in its separate private repository. No dependencies, JavaScript, analytics, third-party embeds or build step.

## Files

- `index.html`: project introduction. The signal artwork is an illustration, **not an app-output sample**.
- `support.html`: public GitHub Issues, quick start and TestFlight feedback.
- `privacy.html`: current app behaviour, local settings, TestFlight, website hosting and public support.
- `404.html`: GitHub Pages error page (base path `/gleitzsch-site/`).
- `.github/ISSUE_TEMPLATE/`: bug and idea forms. GitHub Issues must be enabled in repository settings.

## Preview

Run `python3 -m http.server 8766 --bind 127.0.0.1` from this directory and open http://127.0.0.1:8766/ . Stop with Ctrl-C.

## Publish with GitHub Pages

In this repository’s Settings → Pages, select **Deploy from a branch**, branch **main**, folder **/ (root)**. No Actions workflow or access token is needed in this repository. `.nojekyll` keeps it a plain static site.

Expected URLs after Pages is enabled and deployment succeeds:

- https://kirilenkobm.github.io/gleitzsch-site/
- https://kirilenkobm.github.io/gleitzsch-site/support.html
- https://kirilenkobm.github.io/gleitzsch-site/privacy.html

These URLs are planned destinations, not evidence of a live deployment. For a custom domain or renamed repository, update the base URL in `404.html`.

## Before wider release

- Choose a private support contact for sensitive requests; currently only public Issues and TestFlight feedback are offered. No email is invented or exposed.
- Review the privacy text and any applicable publisher/contact disclosures before public commercial distribution. This describes implementation, not a certification of legal compliance.
- Add the real public TestFlight or App Store URL when available. Until then the site honestly says “In development”; no disabled or fake download buttons.
- Replace or supplement the labelled signal illustration with owner-approved real app photographs/video. Do not copy private lab photographs into this public repository.
- Donation link: not configured. After choosing a provider/account, add a plain external link on the homepage (no payment embed) and update the privacy text if necessary. Review Apple’s current rules separately before adding payment links inside the iOS app.
- Social links: add only accounts the owner actually creates.

## Later product directions

Photo-library import and video capture are future ideas, not current capabilities or release promises.

## Content

Made with 🔮 in Berlin. Copyright © 2026 Bogdan Kirilenko. No open-source licence is granted by making this website repository public.
