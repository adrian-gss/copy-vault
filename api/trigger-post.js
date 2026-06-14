// Vercel Cron endpoint — triggers the GitHub Actions "Daily Post" workflow.
// Scheduled in vercel.json. Vercel invokes this once a day (GET request) and,
// when CRON_SECRET is set, includes "Authorization: Bearer <CRON_SECRET>" so
// random visitors can't trigger posts. We then call the GitHub API to dispatch
// the workflow, which renders the image and publishes to Instagram + LinkedIn.
module.exports = async (req, res) => {
  const auth = req.headers['authorization'];
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Missing GH_DISPATCH_TOKEN env var' });
    return;
  }

  try {
    const r = await fetch(
      'https://api.github.com/repos/adrian-gss/copy-vault/actions/workflows/daily-post.yml/dispatches',
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'copy-vault-cron',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (r.status === 204) {
      res.status(200).json({ ok: true, dispatched: true, at: new Date().toISOString() });
      return;
    }

    const body = await r.text();
    res.status(502).json({ ok: false, githubStatus: r.status, body });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
