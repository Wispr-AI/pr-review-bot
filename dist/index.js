#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const web_api_1 = require("@slack/web-api");
// Environment variables
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
// Event type passed from GitHub Actions
const EVENT_TYPE = process.env.EVENT_TYPE; // 'review_commented', 'review_approved', 'review_approved_with_comments', 'merged'
const PR_URL = process.env.PR_URL;
const slackClient = new web_api_1.WebClient(SLACK_BOT_TOKEN);
// Emoji mapping based on PR events
const EMOJI_MAP = {
    review_commented: 'speech_balloon', // 💬 - review with comments (not approved)
    review_approved: 'git-approved', // Custom: approved without comments
    review_approved_with_comments: 'approved-with-comments', // Custom: approved with comments
    merged: 'git-merged', // Custom: PR merged
    circleci_pass: 'circleci-pass', // Custom: CircleCI tests passed
    circleci_fail: 'circleci-fail', // Custom: CircleCI tests failed
};
async function findMessageWithPrUrl(channelId, prUrl) {
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
                return message.ts;
            }
        }
        console.log('No message found containing PR URL');
        return null;
    }
    catch (error) {
        console.error('Error searching messages:', error);
        return null;
    }
}
async function addReaction(channelId, timestamp, emoji) {
    try {
        await slackClient.reactions.add({
            channel: channelId,
            timestamp: timestamp,
            name: emoji,
        });
        console.log(`Added reaction: ${emoji}`);
    }
    catch (error) {
        // Ignore if reaction already exists
        if (error.data?.error === 'already_reacted') {
            console.log(`Reaction ${emoji} already exists`);
        }
        else {
            console.error('Error adding reaction:', error);
            throw error;
        }
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
    console.log('Done!');
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
