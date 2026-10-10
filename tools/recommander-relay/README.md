# Recommander relay

The deck builder's Commander suggestions come from [Recommander](https://recommander.cards).
Its API answers only Recommander's own website from a browser, so the app asks
through a small relay: the Cloudflare Worker in `worker.js`. It only calls
Recommander's recommend endpoint, only for the app's own pages, and keeps an
answer for ten minutes so the same deck isn't asked about twice.

Cloudflare's free plan covers it: 100,000 requests a day.

## Setting it up (about five minutes)

1. Make a free account at <https://dash.cloudflare.com/sign-up> and sign in.
2. In the left menu open **Compute (Workers)** (on some accounts it's called **Workers & Pages**).
3. Click **Create**, choose **Start with Hello World!** (a Worker, not Pages), and give it a name, for example `recommander-relay`.
4. Click **Deploy**, then **Edit code**.
5. Delete everything in the editor and paste in the whole of `worker.js`.
6. Click **Deploy** again.
7. Copy the Worker's address shown at the top, e.g. `https://recommander-relay.yourname.workers.dev`.

Then either send that address to whoever builds the app so it becomes the
default, or paste it into the app yourself: **Options → Suggestions →
Recommander relay**, then **Test**.

## If the app moves

The relay only answers the pages listed in `ALLOWED` at the top of `worker.js`.
If the app is published somewhere else, add that address there and deploy again.
