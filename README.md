# PR Review Slack Bot

Reusable bot that automatically adds emoji reactions to PR review requests in Slack based on GitHub events.

**Works across all your repos** — set it up once, use it everywhere.

## How it works

1. Someone posts a PR review request in `#03-pr-reviews-product-eng` using the Slack workflow
2. When GitHub PR events happen (review submitted, approved, merged), this bot:
   - Finds the Slack message containing the PR URL
   - Adds the appropriate emoji reaction
   - Updates the message with the PR title (on first event)

## Emoji reactions

- 👀 (`:eyes:`) - Manually added by reviewers when they start looking at a PR
- 💬 (`:speech_balloon:`) - Bot adds when someone submits a review with comments
- ✅ (`:white_check_mark:`) - Bot adds when a review is approved
- 🚀 (`:rocket:`) - Bot adds when the PR is merged

---

## One-Time Setup (Workspace Level)

### 1. Create Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. Name: "PR Review Bot"
4. Select your workspace

### 2. Add Slack Bot Scopes

Go to **OAuth & Permissions** → **Bot Token Scopes** and add:
- `channels:history` - to search for messages
- `channels:read` - to list channels
- `reactions:write` - to add emoji reactions
- `chat:write` - to update messages with PR titles

### 3. Install Slack App to Workspace

1. In **OAuth & Permissions**, click **Install to Workspace**
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
3. Invite the bot to your PR review channel:
   ```
   /invite @PR Review Bot
   ```
   in `#03-pr-reviews-product-eng`

### 4. Get Slack Channel ID

1. Right-click on `#03-pr-reviews-product-eng` in Slack
2. Select **View channel details**
3. Scroll down and copy the **Channel ID** (e.g., `C07ABC123DEF`)

### 5. Create Slack Workflow (for posting PRs)

In `#03-pr-reviews-product-eng`:
1. Click channel name → **Workflows** → **Create Workflow** → **From scratch**
2. Name it "Request PR Review"
3. Trigger: **"from a link in Slack"**
4. Add step: **"Open a form"** with 2 fields:
   - **GitHub PR Link** (required, short text)
   - **Linear Ticket** (optional, short text)
5. Add step: **"Send a message"** to `#03-pr-reviews-product-eng`:
   ```
   🔍 PR Review Request
   📎 {{GitHub PR Link}}
   🎫 {{Linear Ticket}}
   ```
6. Publish the workflow

---

## Per-Repo Setup

For **each repo** that you want to use this bot:

### 1. Add GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these secrets:
- `SLACK_BOT_TOKEN` - the bot token from workspace setup (starts with `xoxb-`)
- `SLACK_CHANNEL_ID` - the channel ID from workspace setup

(Note: `GITHUB_TOKEN` is automatically provided by GitHub Actions)

### 2. Add GitHub Workflow

Copy `workflow-template.yml` to your repo at:
```
.github/workflows/pr-review-reactions.yml
```

**Update line 24** with the actual GitHub URL for this bot repo:
```yaml
git clone https://github.com/YOUR_ORG/pr-review-bot.git /tmp/pr-review-bot
```

### 3. Commit and Push

```bash
git add .github/workflows/pr-review-reactions.yml
git commit -m "Add PR review Slack bot workflow"
git push
```

### 4. Test it!

1. Create a test PR
2. Post it in the Slack channel using the workflow
3. Submit a review on GitHub (with comments or approval)
4. Watch the bot add reactions! 🎉

---

## Publishing the Bot (Optional)

To make setup even easier, you can publish this bot to npm:

1. Create a GitHub repo for this bot
2. Push the code
3. Publish to npm:
   ```bash
   npm publish
   ```

Then repos can install it via:
```yaml
- name: Install pr-review-bot
  run: npm install -g pr-review-bot
```

---

## Troubleshooting

### Bot doesn't add reactions

- Check GitHub Actions logs in your repo's **Actions** tab
- Verify the bot is invited to the Slack channel
- Verify the secrets are set correctly in GitHub
- Make sure the PR URL in Slack exactly matches the GitHub PR URL

### Message not found

The bot searches the last 100 messages in the channel. If your channel is very active, the message might be too old. Consider:
- Increasing the `limit` in `src/index.ts` (line 31)
- Or building a simple mapping database to store PR URL → Slack message timestamp

### Bot can't fetch PR title

- Verify `GITHUB_TOKEN` has read access to the repo
- Check that the PR URL format is correct

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Repo (typing-test, ml-service, etc.)            │
│                                                          │
│  1. PR event happens (review, approval, merge)          │
│     ↓                                                    │
│  2. GitHub Action triggers (.github/workflows/)         │
│     ↓                                                    │
│  3. Installs & runs pr-review-bot                       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  pr-review-bot (this repo)                              │
│                                                          │
│  1. Searches Slack for message with PR URL              │
│  2. Adds emoji reaction based on event type             │
│  3. Fetches PR title from GitHub API                    │
│  4. Updates Slack message with PR title link            │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  Slack (#03-pr-reviews-product-eng)                     │
│                                                          │
│  🔍 PR Review Request                                    │
│  📎 Add dark mode support (#123)                        │
│  🎫 https://linear.app/wispr/issue/ENG-456              │
│  👀 💬 ✅ 🚀  ← emoji reactions                         │
└─────────────────────────────────────────────────────────┘
```

---

## Future improvements

- Store PR URL → Slack message mappings in a database for faster lookup
- Support multiple Slack channels
- Add more event types (PR opened, draft ready for review, etc.)
- Publish to npm for easier installation
- Create a Docker action for even simpler setup
