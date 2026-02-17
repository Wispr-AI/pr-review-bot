#!/usr/bin/env node
import { WebClient } from '@slack/web-api';
import { Octokit } from '@octokit/rest';

// Environment variables
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID!;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Event type passed from GitHub Actions
const EVENT_TYPE = process.env.EVENT_TYPE!; // 'review_commented', 'review_approved', 'merged'
const PR_URL = process.env.PR_URL!;

const slackClient = new WebClient(SLACK_BOT_TOKEN);
const githubClient = new Octokit({ auth: GITHUB_TOKEN });

// Emoji mapping based on PR events
const EMOJI_MAP: Record<string, string> = {
  review_commented: 'speech_balloon', // 💬
  review_approved: 'white_check_mark', // ✅
  merged: 'rocket', // 🚀
};

async function findMessageWithPrUrl(channelId: string, prUrl: string): Promise<string | null> {
  try {
    console.log(`Searching for PR URL: ${prUrl} in channel: ${channelId}`);

    // Search recent messages in the channel
    // Note: We'll search the last 100 messages. For high-volume channels,
    // you might want to maintain a mapping DB instead.
    const result = await slackClient.conversations.history({
      channel: channelId,
      limit: 100,
    });

    if (!result.messages) {
      console.log('No messages found in channel');
      return null;
    }

    // Find message containing the PR URL
    for (const message of result.messages) {
      if (message.text && message.text.includes(prUrl)) {
        console.log(`Found message: ${message.ts}`);
        return message.ts!;
      }
    }

    console.log('No message found containing PR URL');
    return null;
  } catch (error) {
    console.error('Error searching messages:', error);
    return null;
  }
}

async function addReaction(channelId: string, timestamp: string, emoji: string): Promise<void> {
  try {
    await slackClient.reactions.add({
      channel: channelId,
      timestamp: timestamp,
      name: emoji,
    });
    console.log(`Added reaction: ${emoji}`);
  } catch (error: any) {
    // Ignore if reaction already exists
    if (error.data?.error === 'already_reacted') {
      console.log(`Reaction ${emoji} already exists`);
    } else {
      console.error('Error adding reaction:', error);
      throw error;
    }
  }
}

async function getPrTitle(prUrl: string): Promise<string | null> {
  try {
    // Parse GitHub PR URL: https://github.com/owner/repo/pull/123
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) {
      console.log('Invalid PR URL format');
      return null;
    }

    const [, owner, repo, pullNumber] = match;

    const { data: pr } = await githubClient.pulls.get({
      owner,
      repo,
      pull_number: parseInt(pullNumber, 10),
    });

    return pr.title;
  } catch (error) {
    console.error('Error fetching PR title:', error);
    return null;
  }
}

async function updateMessageWithPrTitle(
  channelId: string,
  timestamp: string,
  prUrl: string,
  prTitle: string
): Promise<void> {
  try {
    // Fetch the original message
    const result = await slackClient.conversations.history({
      channel: channelId,
      latest: timestamp,
      limit: 1,
      inclusive: true,
    });

    if (!result.messages || result.messages.length === 0) {
      console.log('Could not fetch original message');
      return;
    }

    const originalText = result.messages[0].text || '';

    // Replace the PR URL with a formatted link
    const updatedText = originalText.replace(
      prUrl,
      `<${prUrl}|${prTitle}>`
    );

    await slackClient.chat.update({
      channel: channelId,
      ts: timestamp,
      text: updatedText,
    });

    console.log(`Updated message with PR title: ${prTitle}`);
  } catch (error) {
    console.error('Error updating message:', error);
  }
}

async function main() {
  console.log('Starting PR Review Bot...');
  console.log(`Event type: ${EVENT_TYPE}`);
  console.log(`PR URL: ${PR_URL}`);

  // Find the Slack message containing this PR URL
  const messageTimestamp = await findMessageWithPrUrl(SLACK_CHANNEL_ID, PR_URL);

  if (!messageTimestamp) {
    console.log('Could not find Slack message for this PR. Exiting.');
    return;
  }

  // Get the appropriate emoji for this event
  const emoji = EMOJI_MAP[EVENT_TYPE];
  if (!emoji) {
    console.log(`Unknown event type: ${EVENT_TYPE}`);
    return;
  }

  // Add the reaction
  await addReaction(SLACK_CHANNEL_ID, messageTimestamp, emoji);

  // Optionally fetch and update with PR title (only on first event)
  if (EVENT_TYPE === 'review_commented' || EVENT_TYPE === 'review_approved') {
    const prTitle = await getPrTitle(PR_URL);
    if (prTitle) {
      await updateMessageWithPrTitle(SLACK_CHANNEL_ID, messageTimestamp, PR_URL, prTitle);
    }
  }

  console.log('Done!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
