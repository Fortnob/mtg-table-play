# mtg-table-play

A static site (no build step, no backend), served from GitHub Pages.

## Moving your data between browsers

Everything the app keeps for you (collection, Shards, packs, wildcards, sleeves including a GIF sleeve, decks, cubes, settings, name and picture) lives in this browser. To move it:

1. Open **Options** and find **Back up your profile**.
2. Click **Save to a file** to download `mtg-table-profile-YYYY-MM-DD.json` (marked with the app name, a schema version `v` and a timestamp `at`).
3. In the other browser, click **Load from a file…** and pick that file. After you confirm, it **replaces** what that browser has and the page reloads.

Card-data and art caches are left out; they are fetched again as needed. Files that are not a profile backup, or that come from a newer version, are refused with a message.
