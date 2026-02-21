#!/usr/bin/env node
import {
  REPOS,
  gatherRepoStats,
  mergeStats,
  formatMessage,
  formatNumber,
  formatDateRange,
  rankBy,
  ReviewerStats,
  RepoStats,
} from './weekly-awards';

function printLeaderboard(
  title: string,
  stats: Map<string, ReviewerStats>,
  metric: (s: ReviewerStats) => number,
  format: (s: ReviewerStats) => string,
): void {
  console.log(`  ${title}:`);

  const sorted = [...stats.entries()]
    .filter(([, s]) => metric(s) > 0)
    .sort((a, b) => metric(b[1]) - metric(a[1]));

  if (sorted.length === 0) {
    console.log('    (no activity)');
  } else {
    sorted.forEach(([username, s], i) => {
      const marker = i === 0 ? '>>>' : '   ';
      console.log(`    ${marker} ${i + 1}. @${username} — ${format(s)}`);
    });
  }
  console.log('');
}

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.error('Error: GITHUB_TOKEN environment variable is required.');
    console.error('Set it to a GitHub PAT with repo read access.');
    process.exit(1);
  }

  console.log('Fetching PR review data...\n');

  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sinceDate = since.toISOString();

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
    console.error('All repos failed. Cannot generate preview.');
    process.exit(1);
  }

  const { global, totalMerged, totalComments } = mergeStats(successfulStats);
  const dateRange = formatDateRange(since, now);

  // Full leaderboard
  console.log(`\n=== PR Review Leaderboard — Week of ${dateRange} ===\n`);

  // Top 3 Reviewers
  const topReviewers = rankBy(
    global,
    (s) => s.prsReviewed.size,
    (s) => s.commentCount,
  ).slice(0, 3);

  console.log(`  Top Reviewers (PRs reviewed):`);
  if (topReviewers.length === 0) {
    console.log('    (no activity)');
  } else {
    topReviewers.forEach(({ username, stats: s }, i) => {
      const marker = i === 0 ? '>>>' : '   ';
      console.log(`    ${marker} ${i + 1}. @${username} — ${s.prsReviewed.size} PRs reviewed`);
    });
  }
  console.log('');

  // Heavy Lifter (single award)
  printLeaderboard(
    'Heavy Lifter (lines reviewed)',
    global,
    (s) => s.linesReviewed,
    (s) => `${formatNumber(s.linesReviewed)} lines across ${s.linesPrs.size} PRs`,
  );

  // Most Comments (single award)
  printLeaderboard(
    'Most Comments (review comments)',
    global,
    (s) => s.commentCount,
    (s) => `${formatNumber(s.commentCount)} comments across ${s.commentPrs.size} PRs`,
  );

  console.log(`  Team Stats: ${formatNumber(totalMerged)} PRs merged, ${formatNumber(totalComments)} review comments`);

  // Slack message preview
  let message = formatMessage(global, totalMerged, totalComments, since, now);
  if (failedRepos.length > 0) {
    message += `\n\n_:warning: Could not scan: ${failedRepos.join(', ')}_`;
  }

  console.log('\n--- Slack Message Preview ---\n');
  console.log(message);
  console.log('\n--- End Preview ---');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
