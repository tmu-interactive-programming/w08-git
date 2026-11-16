/*
 * Site settings. On GitHub Pages (https://<org>.github.io/<repo>/) the org and repo are
 * detected from the URL automatically; these values are the fallback for local preview.
 */
window.W08_CONFIG = {
  org: 'tmu-interactive-programming', // GitHub Organization name
  siteRepo: 'w08-git',        // this site's repo (holds the class wall)
  teams: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'],
  teamRepo: '{team}',         // team repo name pattern, e.g. '{team}' → G1, 'linebot-{team}' → linebot-G1
  classSize: 42,
  wallPollSeconds: 20,
  wallMaxLength: 80,
  classDate: '2026-11-17'
};
