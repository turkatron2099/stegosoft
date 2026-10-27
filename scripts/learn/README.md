# Learn Something generator

Writes one 300–400 word article a day into `learn.json`, shown by `learn.html`.

## How it works

`generate.py` (Python 3 standard library only):

1. Picks a weighted random category from `topics.json`, then a random seed title in it that isn't already in `learn.json`. It avoids repeating yesterday's category. No technology topics.
2. Fetches the article's plain text and current revision (id and timestamp) from the Wikipedia Action API in one request. It skips the topic and picks another if the article was edited in the last 72 hours, is a biography of a living person (in "Category:Living people"), is a disambiguation page or is too short. It drops the reference sections at the end and trims the text to about 14,000 characters. No Wikipedia images are used.
3. Sends that text on stdin to `claude -p` with **no tools**. The text sits between delimiter lines that carry a random token and is labelled as reference data only. The command is:

   ```
   claude -p --safe-mode --model sonnet --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
     --setting-sources "" --no-session-persistence --system-prompt "<instructions>" \
     --output-format stream-json --verbose
   ```

   It runs in an empty temporary directory, so no CLAUDE.md is loaded. The script fails closed unless claude's `init` message arrives first and shows `tools == []`, `mcp_servers == []` and only `builtin` plugins. It also aborts if the model attempts a tool call.
4. Validates the reply:
   - It must be strict JSON with exactly the keys `title`, `category`, `body` and `source_title`.
   - The body must be 300–400 words in 3–7 paragraphs, within the length caps.
   - Rejected outright: HTML, braces, backticks, `@`, URLs, bare domains, "dot com", phone numbers, citation markers, and control, zero-width or bidi characters.
   - `source_title` and `category` must match what was sent.

   The source URL is built by the script, never taken from the model.
5. Writes `learn.json`, newest first, with dates in America/Chicago. Each entry records the model id and the Wikipedia `revid`. On failure it tries once more with a different topic. If that also fails it exits non-zero and leaves `learn.json` as committed.
6. With `--publish`, the git steps run in this order:
   - It requires the clone to be on `main`.
   - It restores a `learn.json` left dirty by an earlier failed run, and aborts a rebase left in progress.
   - It pulls with rebase, running `git rebase --abort` if that fails.
   - It commits **only** `learn.json` as `thagobyte-bot`. The message names the model and the revision.
   - It pushes to `origin main`, pulling and retrying once if the push is rejected.

   If the add or commit fails, `learn.json` is restored. If an earlier run committed but failed to push, the next run pushes it.

Run it by hand from a checkout:

```
python3 -I scripts/learn/generate.py --dry-run                 # write learn.json, no git
python3 -I scripts/learn/generate.py --dry-run --out /tmp/x.json --date 2026-11-01
python3 -I scripts/learn/generate.py --check-topics            # every seed title exists, none are living people
python3 -I scripts/learn/generate.py --publish --no-push --repo <clone>   # commit locally only (testing)
```

To add topics, put exact English Wikipedia titles in `topics.json` and run `--check-topics`. The list holds about 375 titles, roughly a year of articles. The script exits with a clear error when they run out.

## Installing the daily timer (not done yet)

The timer runs a **reviewed copy** of the code installed in `~/.local/lib/learn-something/`. A dedicated bot clone is used only for `learn.json` and git, and nothing from it is ever executed. That clone pushes with a write deploy key that only works for this repo.

1. Create the deploy key and pin GitHub's host keys. GitHub's keys come from its API over HTTPS, so there is no trust-on-first-use step.

   ```
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   ssh-keygen -t ed25519 -N "" -C "learn-something bot" -f ~/.ssh/learn_bot
   curl -fsS https://api.github.com/meta | jq -r '.ssh_keys[] | "github.com " + .' > ~/.ssh/learn_bot_known_hosts
   gh repo deploy-key add ~/.ssh/learn_bot.pub --repo turkatron2099/stegosoft --title "learn-something bot" --allow-write
   ```

2. Create the bot clone with an ssh remote that uses only that key. The service binds the key and host file read-only to `$XDG_RUNTIME_DIR/learn-bot/`; `~/.ssh` itself is hidden from the job.

   ```
   git clone https://github.com/turkatron2099/stegosoft.git ~/Work/thagobyte/projects/stegosoft-learn-bot
   cd ~/Work/thagobyte/projects/stegosoft-learn-bot
   git remote set-url origin git@github.com:turkatron2099/stegosoft.git
   git config core.sshCommand "ssh -F /dev/null -i $XDG_RUNTIME_DIR/learn-bot/key -o IdentitiesOnly=yes -o UserKnownHostsFile=$XDG_RUNTIME_DIR/learn-bot/known_hosts -o StrictHostKeyChecking=yes"
   ```

   Those paths only exist inside the service. To run git there by hand, use `GIT_SSH_COMMAND="ssh -i ~/.ssh/learn_bot -o IdentitiesOnly=yes -o UserKnownHostsFile=~/.ssh/learn_bot_known_hosts"`.

3. Install the reviewed code and the units, then enable the timer:

   ```
   install -Dm644 -t ~/.local/lib/learn-something/ scripts/learn/generate.py scripts/learn/topics.json scripts/learn/README.md
   cp scripts/learn/deploy/learn-something.{service,timer} ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now learn-something.timer
   ```

It fires at 05:30 Chicago time. `Persistent=true` catches up after downtime. A failed run retries every 10 minutes, up to 4 times. Check it with `systemctl --user list-timers learn-something.timer` and `journalctl --user -u learn-something.service`. Run it once by hand with `systemctl --user start learn-something.service`.

Lingering is **not recommended** (no `loginctl enable-linger`). The job only runs while you're logged in, and `Persistent=true` catches up on the next login.

**Fallback without a deploy key:** comment out the three deploy-key lines in the service, keep the https remote, and leave `~/.config/gh` readable so the gh credential helper works. That token can push to every repo the gh login can, which is why the deploy key is preferred.

### Updating the code

The timer never picks up code changes on its own. After a change to `scripts/learn/` is reviewed and merged, re-run the `install` line above from your reviewed working copy, not the bot clone. If the unit files changed, also re-copy them and run `systemctl --user daemon-reload`.

### Sandbox

The service runs with:

- `ProtectSystem=strict` and `ProtectHome=read-only`.
- Write access only to the bot clone, `~/.claude`, `~/.claude.json`, `~/.cache/claude-cli-nodejs` and mise's state and cache.
- `~/.ssh`, `~/.gnupg`, `~/.config/gh` and `~/.claude/channels` hidden.
- IPv4, IPv6 and Unix sockets only.
- No SUID, realtime or personality changes, and `UMask=0077`.
