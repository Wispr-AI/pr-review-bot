#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const weekly_awards_1 = require("./weekly-awards");
function printLeaderboard(title, stats, metric, format) {
    console.log(`  ${title}:`);
    const sorted = [...stats.entries()]
        .filter(([, s]) => metric(s) > 0)
        .sort((a, b) => metric(b[1]) - metric(a[1]));
    if (sorted.length === 0) {
        console.log('    (no activity)');
    }
    else {
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
    const results = await Promise.allSettled(weekly_awards_1.REPOS.map((repo) => (0, weekly_awards_1.gatherRepoStats)(repo, sinceDate)));
    const successfulStats = [];
    const failedRepos = [];
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            successfulStats.push(result.value);
        }
        else {
            console.error(`Failed to scan ${weekly_awards_1.REPOS[i]}:`, result.reason);
            failedRepos.push(weekly_awards_1.REPOS[i]);
        }
    });
    if (successfulStats.length === 0) {
        console.error('All repos failed. Cannot generate preview.');
        process.exit(1);
    }
    const { global, totalMerged, totalComments } = (0, weekly_awards_1.mergeStats)(successfulStats);
    const dateRange = (0, weekly_awards_1.formatDateRange)(since, now);
    // Full leaderboard
    console.log(`\n=== PR Review Leaderboard — Week of ${dateRange} ===\n`);
    printLeaderboard('Top Reviewer (PRs reviewed)', global, (s) => s.prsReviewed.size, (s) => `${s.prsReviewed.size} PRs reviewed`);
    printLeaderboard('Top Commenter (review comments)', global, (s) => s.commentCount, (s) => `${(0, weekly_awards_1.formatNumber)(s.commentCount)} comments across ${s.commentPrs.size} PRs`);
    printLeaderboard('Heavy Lifter (lines reviewed)', global, (s) => s.linesReviewed, (s) => `${(0, weekly_awards_1.formatNumber)(s.linesReviewed)} lines across ${s.linesPrs.size} PRs`);
    console.log(`  Team Stats: ${(0, weekly_awards_1.formatNumber)(totalMerged)} PRs merged, ${(0, weekly_awards_1.formatNumber)(totalComments)} review comments`);
    // Slack message preview
    let message = (0, weekly_awards_1.formatMessage)(global, totalMerged, totalComments, since, now);
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
