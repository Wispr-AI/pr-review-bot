#!/usr/bin/env node
import { WebClient } from '@slack/web-api';

// Environment variables
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID!;

// One or more comma-separated event types, e.g. "circleci_pass,review_approved,merged"
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

    // Slack returns messages newest-first. We iterate all messages and keep
    // overwriting so we end up with the OLDEST match — the original PR announcement,
    // not a later reply or follow-up message that also happens to contain the URL.
    let oldestMatch: string | null = null;
    let matchCount = 0;
    for (const message of result.messages) {
      if (message.text && message.text.includes(prUrl)) {
        oldestMatch = message.ts!;
        matchCount++;
      }
    }

    if (oldestMatch) {
      if (matchCount > 1) {
        console.log(`Found ${matchCount} messages with PR URL, using oldest (original announcement): ${oldestMatch}`);
      } else {
        console.log(`Found message: ${oldestMatch}`);
      }
    } else {
      console.log('No message found containing PR URL');
    }
    return oldestMatch;
  } catch (error) {
    console.error('Error searching messages:', error);
    return null;
  }
}

async function getMessageReactions(channelId: string, timestamp: string): Promise<string[]> {
  try {
    const result = await slackClient.reactions.get({
      channel: channelId,
      timestamp: timestamp,
    });
    const message = result.message as any;
    if (message?.reactions) {
      return message.reactions.map((r: any) => r.name as string);
    }
    return [];
  } catch (error) {
    console.error('Error getting reactions:', error);
    return [];
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
  console.log(`Event type(s): ${EVENT_TYPE}`);
  console.log(`PR URL: ${PR_URL}`);

  // Find the Slack message containing this PR URL
  const messageTimestamp = await findMessageWithPrUrl(SLACK_CHANNEL_ID, PR_URL);

  if (!messageTimestamp) {
    console.log('Could not find Slack message for this PR. Exiting.');
    return;
  }

  // Support comma-separated event types so callers can re-evaluate all states
  // at once, e.g. EVENT_TYPE="circleci_pass,review_approved"
  const eventTypes = EVENT_TYPE.split(',').map((e) => e.trim()).filter(Boolean);

  // Fetch reactions once upfront — used for CI guard checks across all events
  const existingReactions = await getMessageReactions(SLACK_CHANNEL_ID, messageTimestamp);

  for (const eventType of eventTypes) {
    const reactionInfo = EMOJI_MAP[eventType];
    if (!reactionInfo) {
      console.log(`Unknown event type: ${eventType}, skipping`);
      continue;
    }

    // Once a PR is merged, lock the CI category entirely — post-merge CI runs on
    // the main branch should not flip the PR message back to "running".
    if (reactionInfo.category === 'ci' && existingReactions.includes('git-merged')) {
      console.log('PR is already merged, skipping CI status update to avoid flapping.');
      continue;
    }

    // Don't downgrade CI from a terminal state back to "running".
    // Parallel CI jobs race each other; a late-arriving "running" event from one
    // job should not clobber a "pass" that another job already recorded.
    if (reactionInfo.emoji === 'circleci' && existingReactions.includes('circleci-pass')) {
      console.log('CI already passed, ignoring late "running" event to prevent flapping.');
      continue;
    }

    // Update the reaction state (remove old, add new)
    await updateReactionState(
      SLACK_CHANNEL_ID,
      messageTimestamp,
      reactionInfo.emoji,
      reactionInfo.category
    );

    // Keep the in-memory reactions list consistent for subsequent iterations
    const cat = REACTION_CATEGORIES[reactionInfo.category];
    for (const r of cat) {
      const idx = existingReactions.indexOf(r);
      if (idx !== -1) existingReactions.splice(idx, 1);
    }
    existingReactions.push(reactionInfo.emoji);
  }

  console.log('Done!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
