#!/usr/bin/env node
import { WebClient } from '@slack/web-api';

// Environment variables
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID!;

// Event type passed from GitHub Actions
const EVENT_TYPE = process.env.EVENT_TYPE!;
const PR_URL = process.env.PR_URL!;

const slackClient = new WebClient(SLACK_BOT_TOKEN);

// Reaction categories - mutually exclusive within each category
const REACTION_CATEGORIES = {
  approval: ['speech_balloon', 'approved-with-comments', 'git-approved'],
  ci: ['circleci', 'circleci-pass', 'circleci-fail'],
  merge: ['git-merged'],
};

// Emoji mapping based on PR events
const EMOJI_MAP: Record<string, { emoji: string; category: keyof typeof REACTION_CATEGORIES }> = {
  review_commented: { emoji: 'speech_balloon', category: 'approval' },
  review_approved: { emoji: 'git-approved', category: 'approval' },
  review_approved_with_comments: { emoji: 'approved-with-comments', category: 'approval' },
  circleci_running: { emoji: 'circleci', category: 'ci' },
  circleci_pass: { emoji: 'circleci-pass', category: 'ci' },
  circleci_fail: { emoji: 'circleci-fail', category: 'ci' },
  merged: { emoji: 'git-merged', category: 'merge' },
};

async function findMessageWithPrUrl(channelId: string, prUrl: string): Promise<string | null> {
  try {
    console.log(`Searching for PR URL: ${prUrl} in channel: ${channelId}`);

    const result = await slackClient.conversations.history({
      channel: channelId,
      limit: 100,
    });

    if (!result.messages) {
      console.log('No messages found in channel');
      return null;
    }

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

async function removeReaction(channelId: string, timestamp: string, emoji: string): Promise<void> {
  try {
    await slackClient.reactions.remove({
      channel: channelId,
      timestamp: timestamp,
      name: emoji,
    });
    console.log(`Removed reaction: ${emoji}`);
  } catch (error: any) {
    // Ignore if reaction doesn't exist
    if (error.data?.error === 'no_reaction') {
      console.log(`Reaction ${emoji} doesn't exist (already removed)`);
    } else {
      console.error(`Error removing reaction ${emoji}:`, error);
    }
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
    if (error.data?.error === 'already_reacted') {
      console.log(`Reaction ${emoji} already exists`);
    } else {
      console.error('Error adding reaction:', error);
      throw error;
    }
  }
}

async function updateReactionState(
  channelId: string,
  timestamp: string,
  emoji: string,
  category: keyof typeof REACTION_CATEGORIES
): Promise<void> {
  console.log(`Updating ${category} state to: ${emoji}`);

  // Remove all reactions from this category
  const reactionsToRemove = REACTION_CATEGORIES[category];
  for (const reactionEmoji of reactionsToRemove) {
    if (reactionEmoji !== emoji) {
      await removeReaction(channelId, timestamp, reactionEmoji);
    }
  }

  // Add the new reaction
  await addReaction(channelId, timestamp, emoji);
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

  // Get the appropriate emoji and category for this event
  const reactionInfo = EMOJI_MAP[EVENT_TYPE];
  if (!reactionInfo) {
    console.log(`Unknown event type: ${EVENT_TYPE}`);
    return;
  }

  // Update the reaction state (remove old, add new)
  await updateReactionState(
    SLACK_CHANNEL_ID,
    messageTimestamp,
    reactionInfo.emoji,
    reactionInfo.category
  );

  console.log('Done!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
