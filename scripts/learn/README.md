# Learn Something generator

Writes one 300–400 word article a day into `learn.json`, shown by `learn.html`.

## How it works

`generate.py` (Python 3 standard library only):

1. Picks a weighted random category from `topics.json`, then a random seed title in it that isn't already in `learn.json`. It avoids repeating yesterday's category. No technology topics.
2. Fetches the article's plain text from the Wikipedia Action API (`prop=extracts&explaintext`), drops the reference/link sections at the end and trims it to about 14,000 characters.
3. Sends that text on stdin to `claude -p` with **no tools**. The text is wrapped in delimiter lines carrying a random token and is labelled as reference data only. The command is:

   ```
   claude -p --model sonnet --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
     --setting-sources "" --no-session-persistence --system-prompt "<instructions>" \
     --output-format stream-json --verbose
   ```

   It runs in an empty temporary directory, so no CLAUDE.md is loaded. The script reads the session's `init` message and aborts if any tool or MCP server is listed, or if the model attempts a tool call.
4. Validates the reply: strict JSON with exactly `title`, `category`, `body` and `source_title`; 300–400 words in 3–7 paragraphs; no HTML, braces, backticks, URLs, citation markers or control/bidi characters; length caps; `source_title` and `category` must match what was sent. The source URL is built by the script from the resolved Wikipedia title, never taken from the model.
5. Writes `learn.json` (newest first, dates in America/Chicago). On any failure it tries once more with a different topic, then exits non-zero and leaves `learn.json` untouched.
6. With `--publish` only: requires the repo to be on `main`, pulls with rebase first, commits **only** `learn.json` as `thagobyte-bot`, and pushes to `origin main` (pulling and retrying once if the push is rejected). If an earlier run committed but failed to push, the next run pushes it.

Run it by hand:

```
python3 -I scripts/learn/generate.py --dry-run                 # write learn.json, no git
python3 -I scripts/learn/generate.py --dry-run --out /tmp/x.json --date 2026-11-01
python3 -I scripts/learn/generate.py --check-topics            # check every seed title exists
python3 -I scripts/learn/generate.py --publish                 # what the timer runs
```

Add seed titles to `topics.json` (exact English Wikipedia titles) and run `--check-topics`. The list holds about 375 titles, roughly a year of articles; the script exits with a clear error when they run out.

## Installing the daily timer (not done yet)

The units in `deploy/` run the generator from a dedicated clone, so the timer never touches the working copy you edit in:

```
git clone https://github.com/turkatron2099/stegosoft.git ~/Work/thagobyte/projects/stegosoft-learn-bot
cp ~/Work/thagobyte/projects/stegosoft-learn-bot/scripts/learn/deploy/learn-something.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now learn-something.timer
loginctl enable-linger "$USER"   # only needed if it should run while you're logged out
```

It fires at 05:30 Chicago time (`Persistent=true` catches up after downtime). Check it with `systemctl --user list-timers learn-something.timer` and `journalctl --user -u learn-something.service`. Run once by hand with `systemctl --user start learn-something.service`.

The clone needs push access to `origin` (the `gh` credential helper for https) and `claude` signed in; the unit points at the mise shim `~/.local/share/mise/shims/claude`.
