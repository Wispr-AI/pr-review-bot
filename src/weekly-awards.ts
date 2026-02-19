#!/usr/bin/env node
import { WebClient } from '@slack/web-api';
import { Octokit } from '@octokit/rest';

// ── Environment variables ──────────────────────────────────
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID!;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const DRY_RUN = process.env.DRY_RUN === 'true';

// ── Configuration ──────────────────────────────────────────

// Repos to scan for PR activity (owner/repo format)
const REPOS: string[] = [
  'Wispr-AI/aria-flow',
];

// GitHub username → Slack user ID mapping for @mentions
// Find Slack user IDs: click a user's profile → "⋮" → "Copy member ID"
const GITHUB_TO_SLACK: Record<string, string> = {
  'josh-wispr': '',      // Josh Benson — TODO: add Slack user ID
  'advaith-wispr': '',   // Advaith — TODO: add Slack user ID
  'david-wispr': '',     // David Estrada — TODO: add Slack user ID
  'dillon-wispr': '',    // Dillon Cutaiar — TODO: add Slack user ID
  'duncan-wispr': '',    // Duncan — TODO: add Slack user ID
  'ethan-wispr': '',     // Ethan Carlson — TODO: add Slack user ID
  'george-wispr': '',    // George Linut — TODO: add Slack user ID
  'mark-wispr': '',      // Mark Bennett — TODO: add Slack user ID
  'rajat-wispr': '',     // Rajat — TODO: add Slack user ID
  'shubh-wispr': '',     // Shubh Patni — TODO: add Slack user ID
  // Could not find GitHub accounts for: Malhar Singh, Saujas Nandi
};

// ── Clients ────────────────────────────────────────────────
const slackClient = new WebClient(SLACK_BOT_TOKEN);
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// ── Types ──────────────────────────────────────────────────

interface ReviewerStats {
  prsReviewed: Set<string>;    // "owner/repo#number" keys for dedup
  commentCount: number;
  commentPrs: Set<string>;     // PRs where they left comments
  linesReviewed: number;
  linesPrs: Set<string>;       // PRs contributing to lines count (for dedup)
}

interface RepoStats {
  reviewerStats: Map<string, ReviewerStats>;
  mergedCount: number;
  totalComments: number;
}

// ── Helpers ────────────────────────────────────────────────

function getOrCreateStats(map: Map<string, ReviewerStats>, username: string): ReviewerStats {
  let stats = map.get(username);
  if (!stats) {
    stats = {
      prsReviewed: new Set(),
      commentCount: 0,
      commentPrs: new Set(),
      linesReviewed: 0,
      linesPrs: new Set(),
    };
    map.set(username, stats);
  }
  return stats;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatDateRange(since: Date, until: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sinceMonth = months[since.getMonth()];
  const untilMonth = months[until.getMonth()];
  const sinceDay = since.getDate();
  const untilDay = until.getDate();

  if (sinceMonth === untilMonth) {
    return `${sinceMonth} ${sinceDay}–${untilDay}`;
  }
  return `${sinceMonth} ${sinceDay} – ${untilMonth} ${untilDay}`;
}

function slackMention(githubUsername: string): string {
  const slackId = GITHUB_TO_SLACK[githubUsername];
  if (slackId) {
    return `<@${slackId}>`;
  }
  console.warn(`No Slack mapping for GitHub user: ${githubUsername}`);
  return `@${githubUsername}`;
}

async function fetchAllPages<T>(
  apiCall: (page: number) => Promise<{ data: T[] }>,
  maxPages = 10,
): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = await apiCall(page);
    results.push(...response.data);
    if (response.data.length < 100) break;
  }
  if (results.length >= maxPages * 100) {
    console.warn(`Hit pagination cap (${maxPages} pages). Some data may be missing.`);
  }
  return results;
}

// ── Data Gathering ─────────────────────────────────────────

async function gatherRepoStats(ownerRepo: string, sinceDate: string): Promise<RepoStats> {
  const [owner, repo] = ownerRepo.split('/');
  const reviewerStats = new Map<string, ReviewerStats>();
  let totalComments = 0;

  console.log(`Scanning ${ownerRepo}...`);

  // 1. Fetch recently updated closed PRs, filter to merged within our window
  const closedPRs = await fetchAllPages((page) =>
    octokit.rest.pulls.list({
      owner, repo,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
      page,
    }),
  );

  const mergedPRs = closedPRs.filter((pr) =>
    pr.merged_at && pr.merged_at >= sinceDate,
  );

  console.log(`  Found ${mergedPRs.length} PRs merged since ${sinceDate}`);

  // 2. For each merged PR, fetch detail + reviews and attribute stats
  for (const pr of mergedPRs) {
    const prKey = `${ownerRepo}#${pr.number}`;
    const prAuthor = pr.user?.login;

    // pulls.list doesn't return additions/deletions — fetch the full PR
    const { data: prDetail } = await octokit.rest.pulls.get({
      owner, repo,
      pull_number: pr.number,
    });
    const prLines = (prDetail.additions ?? 0) + (prDetail.deletions ?? 0);

    const reviews = await octokit.rest.pulls.listReviews({
      owner, repo,
      pull_number: pr.number,
      per_page: 100,
    });

    // Deduplicate: track which reviewers we've already credited for this PR
    const creditedReviewers = new Set<string>();

    for (const review of reviews.data) {
      const reviewer = review.user?.login;
      if (!reviewer) continue;
      if (review.user?.type !== 'User') continue;     // skip bots
      if (reviewer === prAuthor) continue;              // skip self-reviews
      if (creditedReviewers.has(reviewer)) continue;    // one credit per PR

      creditedReviewers.add(reviewer);
      const stats = getOrCreateStats(reviewerStats, reviewer);
      stats.prsReviewed.add(prKey);
      stats.linesReviewed += prLines;
      stats.linesPrs.add(prKey);
    }
  }

  // 3. Fetch review comments for the time window
  const comments = await fetchAllPages((page) =>
    octokit.rest.pulls.listReviewCommentsForRepo({
      owner, repo,
      since: sinceDate,
      sort: 'created',
      direction: 'desc',
      per_page: 100,
      page,
    }),
  );

  for (const comment of comments) {
    const commenter = comment.user?.login;
    if (!commenter) continue;
    if (comment.user?.type !== 'User') continue;
    // Skip low-effort comments (e.g. "LGTM", emoji, "nit")
    const body = (comment.body ?? '').trim();
    if (body.split(/\s+/).length <= 2) continue;

    const prNumber = comment.pull_request_url?.split('/').pop();
    const prKey = `${ownerRepo}#${prNumber}`;

    const stats = getOrCreateStats(reviewerStats, commenter);
    stats.commentCount++;
    stats.commentPrs.add(prKey);
    totalComments++;
  }

  console.log(`  ${reviewerStats.size} reviewers, ${totalComments} comments`);

  return {
    reviewerStats,
    mergedCount: mergedPRs.length,
    totalComments,
  };
}

// ── Aggregation ────────────────────────────────────────────

function mergeStats(allRepoStats: RepoStats[]): {
  global: Map<string, ReviewerStats>;
  totalMerged: number;
  totalComments: number;
} {
  const global = new Map<string, ReviewerStats>();
  let totalMerged = 0;
  let totalComments = 0;

  for (const repoStats of allRepoStats) {
    totalMerged += repoStats.mergedCount;
    totalComments += repoStats.totalComments;

    for (const [username, stats] of repoStats.reviewerStats) {
      const g = getOrCreateStats(global, username);
      for (const pr of stats.prsReviewed) g.prsReviewed.add(pr);
      g.commentCount += stats.commentCount;
      for (const pr of stats.commentPrs) g.commentPrs.add(pr);
      for (const pr of stats.linesPrs) {
        if (!g.linesPrs.has(pr)) {
          g.linesPrs.add(pr);
          // Only add lines once per PR globally (in case of cross-repo duplication edge)
        }
      }
      // Lines are additive across repos since each repo's PRs are distinct
      g.linesReviewed += stats.linesReviewed;
    }
  }

  return { global, totalMerged, totalComments };
}

// ── Winner Selection ───────────────────────────────────────

function pickWinner(
  stats: Map<string, ReviewerStats>,
  metric: (s: ReviewerStats) => number,
  tiebreak: (s: ReviewerStats) => number,
): { username: string; stats: ReviewerStats } | null {
  let best: { username: string; stats: ReviewerStats } | null = null;

  for (const [username, s] of stats) {
    if (!best) {
      best = { username, stats: s };
      continue;
    }
    const val = metric(s);
    const bestVal = metric(best.stats);
    if (val > bestVal) {
      best = { username, stats: s };
    } else if (val === bestVal) {
      const tb = tiebreak(s);
      const bestTb = tiebreak(best.stats);
      if (tb > bestTb || (tb === bestTb && username < best.username)) {
        best = { username, stats: s };
      }
    }
  }

  return best;
}

// ── Message Formatting ─────────────────────────────────────

function formatMessage(
  global: Map<string, ReviewerStats>,
  totalMerged: number,
  totalComments: number,
  since: Date,
  until: Date,
): string {
  const dateRange = formatDateRange(since, until);

  const topReviewer = pickWinner(
    global,
    (s) => s.prsReviewed.size,
    (s) => s.commentCount,
  );

  const topCommenter = pickWinner(
    global,
    (s) => s.commentCount,
    (s) => s.commentPrs.size,
  );

  const heavyLifter = pickWinner(
    global,
    (s) => s.linesReviewed,
    (s) => s.linesPrs.size,
  );

  // Check if there's any activity at all
  if (!topReviewer && !topCommenter && !heavyLifter) {
    return `:desert_island: *Weekly PR Review Awards — Week of ${dateRange}*\n\n` +
      `It was a quiet week — no PR reviews to report. Enjoy the downtime!`;
  }

  const lines: string[] = [
    `:trophy: *Weekly PR Review Awards — Week of ${dateRange}*\n`,
  ];

  if (topReviewer) {
    const s = topReviewer.stats;
    lines.push(`:star: *Top Reviewer:* ${slackMention(topReviewer.username)} (${s.prsReviewed.size} PRs reviewed)`);
  }

  if (topCommenter) {
    const s = topCommenter.stats;
    lines.push(`:speech_balloon: *Top Commenter:* ${slackMention(topCommenter.username)} (${formatNumber(s.commentCount)} comments across ${s.commentPrs.size} PRs)`);
  }

  if (heavyLifter) {
    const s = heavyLifter.stats;
    lines.push(`:weight_lifter: *Heavy Lifter:* ${slackMention(heavyLifter.username)} (${formatNumber(s.linesReviewed)} lines reviewed across ${s.linesPrs.size} PRs)`);
  }

  lines.push('');
  lines.push(`:bar_chart: *Team Stats:* ${formatNumber(totalMerged)} PRs merged, ${formatNumber(totalComments)} review comments`);

  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  console.log('Starting Weekly PR Awards...');

  if (REPOS.length === 0) {
    console.error('No repos configured. Add repos to the REPOS array in src/weekly-awards.ts');
    process.exit(1);
  }

  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sinceDate = since.toISOString();

  console.log(`Scanning ${REPOS.length} repos for activity since ${sinceDate}`);

  // Gather stats from all repos in parallel
  const results = await Promise.allSettled(
    REPOS.map((repo) => gatherRepoStats(repo, sinceDate)),
  );

  const successfulStats: RepoStats[] = [];
  const failedRepos: string[] = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      successfulStats.push(result.value);
    } else {
      console.error(`Failed to scan ${REPOS[i]}:`, result.reason);
      failedRepos.push(REPOS[i]);
    }
  });

  if (successfulStats.length === 0) {
    console.error('All repos failed. Cannot generate awards.');
    process.exit(1);
  }

  // Aggregate across repos
  const { global, totalMerged, totalComments } = mergeStats(successfulStats);

  // Format message
  let message = formatMessage(global, totalMerged, totalComments, since, now);

  if (failedRepos.length > 0) {
    message += `\n\n_:warning: Could not scan: ${failedRepos.join(', ')}_`;
  }

  if (DRY_RUN) {
    console.log('\n=== DRY RUN — Message that would be posted: ===\n');
    console.log(message);
    console.log('\n=== End of message ===');
    return;
  }

  // Post to Slack
  console.log('Posting awards to Slack...');
  await slackClient.chat.postMessage({
    channel: SLACK_CHANNEL_ID,
    text: message,
  });

  console.log('Done! Awards posted.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
