# Takedown, copyright and opt-out — World Wide Maze (revival)

> **DRAFT — not legal advice. Prepared as a starting point for review.**
>
> Not published and not linked from the site. The public text (Part A) needs review by the operator and a lawyer.
> Part B is the internal operator procedure; it is **not** for publication. Defaults chosen for this draft are
> listed in [README.md](README.md).

| Placeholder | Meaning |
|---|---|
| `{{OPERATOR_NAME}}` | Legal name of the operator (also the designated copyright agent unless someone else is named) |
| `{{POSTAL_ADDRESS}}` | Postal address for notices (needed for a US DMCA designated-agent registration) |
| `{{CONTACT_EMAIL}}` | Address that receives takedown, opt-out and copyright notices |
| `{{DOMAIN}}` | The site's domain |
| `{{JURISDICTION}}` | Governing law / where the operator is based |
| `{{EFFECTIVE_DATE}}` | Date this page takes effect / was last updated |

---

# Part A — public page

**World Wide Maze (revival)** at `https://{{DOMAIN}}` · run by {{OPERATOR_NAME}} · Effective: {{EFFECTIVE_DATE}}

World Wide Maze turns public web pages into game levels: a screenshot of a page becomes the ground a ball rolls
on. Mazes that players build are unlisted (reachable only by their link) and are deleted automatically after
30 days. A small set of featured stages, chosen by us from pages whose licences allow reuse or whose owners gave
permission, stay on the site; their sources and licences are credited in the game.

We want site owners to be comfortable with this. You can opt out, ask for removal, or send a copyright notice,
all at **{{CONTACT_EMAIL}}**.

## Response times
| Request | We acknowledge within | We act within |
|---|---|---|
| Opt-out of a domain | 3 business days | 7 days after ownership is verified |
| Remove a specific maze or leaderboard entry | 3 business days | 7 days |
| Copyright notice (complete) | 3 business days | 7 days; urgent or clearly infringing cases sooner |
| Personal data, illegal content, or content that endangers someone | 1 business day | As soon as possible, normally within 2 business days |

In an emergency we can stop all new mazes from being built within minutes while we deal with a problem.

## 1. Opt your site out
Send an email to {{CONTACT_EMAIL}} with the subject "Opt-out" and the domain. To show you control the domain,
either:
- send the email from an address at that domain, or
- publish a DNS TXT record `wwm-optout=<token>` on the domain, using the token we send you in reply.

Once your domain is opted out:
- no new maze can be built from any page on that domain or its subdomains, whether through the site or a link
  portal in another maze;
- every existing maze made from it is deleted, including featured stages; and
- the opt-out stays in place until you ask us to lift it.

Shared mazes made with our browser extension are captured in the visitor's own browser, not by our server, so we
can't block the capture itself; but a shared maze of an opted-out domain is refused on upload and deleted on
request.

**How our capture browser identifies itself.** Captures run in a headless Chrome on Cloudflare's network. Its user
agent includes the token `WorldWideMaze` and a link to `https://{{DOMAIN}}/about`. Each build fetches one page and
the resources it needs to display, once; results are cached for 7 days so popular pages aren't fetched repeatedly.
We follow `robots.txt` rules that name `WorldWideMaze` specifically:

```
User-agent: WorldWideMaze
Disallow: /
```

Because a capture is a one-off fetch that a person asked for (like a link preview), we don't treat generic
`User-agent: *` rules as an opt-out; use the rule above or the email opt-out.

## 2. Remove a specific maze or leaderboard entry
Send the link (`https://{{DOMAIN}}/play/<id>` or `https://{{DOMAIN}}/s/<id>`) and say what should be removed and
why. Players can ask for their own leaderboard entries to be removed; give the name, score, date and stage.

## 3. Copyright notices
If you believe a maze or other content on the site infringes your copyright, send a notice to our designated
agent:

> {{OPERATOR_NAME}}, Copyright agent · {{POSTAL_ADDRESS}} · {{CONTACT_EMAIL}}

Include:
1. your physical or electronic signature;
2. identification of the copyrighted work;
3. the link to the maze or content you want removed;
4. your name, postal address, telephone number and email address;
5. a statement that you have a good-faith belief that the use isn't authorised by the copyright owner, its agent
   or the law; and
6. a statement that the information in the notice is accurate and, under penalty of perjury, that you are the
   owner or authorised to act on the owner's behalf.

(These are the elements listed in 17 U.S.C. § 512(c)(3). Notices from outside the US that contain the same
information are handled the same way.) If a notice is incomplete, we'll tell you what's missing.

**Counter-notice.** If content you shared was removed and you believe that was a mistake, you can send a
counter-notice to the same address with: your signature; identification of the removed content and its link; a
statement under penalty of perjury that you have a good-faith belief it was removed by mistake or
misidentification; your name, address and phone number; and consent to the jurisdiction of the relevant court and
to accept service from the person who sent the original notice. Because shared mazes expire after 30 days
anyway, we won't normally restore removed content.

**Repeat infringers.** There are no accounts, but we may block addresses, domains or sources that are repeatedly
used to infringe.

## 4. Trademarks and the original World Wide Maze
This is an unofficial, non-commercial tribute; see the [tribute disclaimer](tribute-disclaimer.md). If you hold
rights in *World Wide Maze* or in a mark shown on the site and have a concern, write to {{CONTACT_EMAIL}}; we will
respond within the times above and are willing to change names, wording or content.

## 5. Misuse of notices
Knowingly false notices may create liability for the sender. We may publish anonymised statistics about the
number of requests we receive.

---

# Part B — operator procedure (internal; do not publish)

Tested locally with `wrangler dev`; production commands need `--env production --remote`. Run from `apps/worker`.

0. **Log the ticket** (date received, requester, domain/link, type, deadline from the table above) and send the
   acknowledgement. Emergencies: engage the capture kill switch first (runbook §5.1).
1. **Verify** domain control for opt-outs (sender address at the domain, or the DNS TXT token:
   `dig +short TXT <domain>`). For copyright notices, check the six elements are present.
2. **Block the domain** (covers the domain and all subdomains; checked before the cache, so it applies to cached
   runs at once):
   `pnpm exec wrangler kv key put --binding CACHE "optout:<domain>" "<date> <ticket>" --env production --remote`
3. **Remove existing runs** for that domain: find them with
   `pnpm exec wrangler d1 execute wwm --env production --remote --command "SELECT run_id, url FROM runs WHERE url LIKE '%<domain>%'"`,
   then delete the R2 objects (`stages/<stageId>.json`, `textures/<captureId>/*`, `captures/<captureId>/*`), the
   `runs`/`stages` rows (the retention sweep in `apps/worker/src/store.ts` shows the exact keys), and the KV cache
   keys `run:<normalizedUrl>:*`. If the run is featured, also remove it from `content/curated.json` and the D1
   `curated` table. [Follow-up: a one-command admin script; see docs/launch/checklist.md.]
4. **Remove a leaderboard entry:** `DELETE FROM scores WHERE id = ?` (and its `replay_key` object in R2), or
   `DELETE FROM run_scores WHERE id = ?`.
5. **Reply** to the requester confirming what was done, and close the ticket. For a copyright notice about content a
   player shared, there is no account to notify; keep the notice with the ticket.
6. Keep ticket records for 2 years, then delete them.
