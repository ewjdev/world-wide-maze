---
version: 1
slug: "apps-web-src-admin-adminpage-tsx"
primary_target: "apps/web/src/admin/AdminPage.tsx"
related_targets: ["apps/web/src/admin/admin.css","apps/web/src/admin/CostControls.tsx"]
---

# Admin redesign direction

Mode: Operate. Scope: /admin and its existing panels. Preserve authenticated APIs, moderation decisions, rule scope, confirmation requirements, saved settings, budget semantics, and /admin/jev behavior.

Observed problems: budget setup occupies the first viewport; per-feature pause checkboxes inherit full-width field styling; serif showcase styles override the intended admin sans; Jev's local enabled flag conflicts with its effective budget pause; capture review, attempts and policy are mixed into one long page.

Incumbent identity: restrained paper/ink/teal from showcase.css; Instrument Sans for operator UI, teal selection/actions, red destructive actions, clear borders, standard form controls. Use a fixed type scale and native task navigation. No new decoration or charts without useful data.

Grounded structures in resonance order:
1. Persistent section rail and capture queue/detail split view.
2. Full-width catalog table with an inline selected-run inspector.
3. Service overview followed by explicit task entry points.
4. Chronological capture-attempt activity with selected-run evidence.
5. Compact global status strip, task tabs, and review queue/evidence workbench.
6. Guided single-capture review sequence with context and return-to-queue.
7. Status columns for pending, approved and blocked runs, opening full evidence.

Surface seed c96014f8 assigned candidate 5. The top-tab workbench is the proposed structure. Comps vary tabbed workbench, persistent section rail, and operations overview to resolve first-viewport density and navigation. No challenger replaces the established identity: card stacks add navigational friction, teletext limits legibility, printed plates obscure forms, and the physical network/textile directions do not clarify this operator task.

Snapshot examples in comps are illustrative design data based on observed fields, never backend claims. Preserve no total-count claim beyond loaded page results. Status should explicitly say individual services are paused; do not label the entire application healthy from the budget level alone. Reserved spend is not actual billing. Future implementation must fetch and display real state and preserve user changes.

Approved: option A. User: “lets go with option A”. Implemented candidate 5 with existing Instrument Sans, compact budget masthead, five task destinations, one-third capture queue and two-thirds inspector.

Build inventory: native search/status controls; selected teal queue row; opt-in single-image evidence selector with full-size link and access to every slice; primary decisions immediately below evidence; reason and explicit confirmation; secondary capture metadata, rules, operations and history in a disclosure. Mobile stacks search over status/submit and opens a selected inspector with a return-to-queue button. Other task panels retain their draft state when hidden; Jev polling pauses outside its section.

Semantics: shared budget snapshot describes known budget gates; reserved spend is distinct from billing. No provider readiness or quota claim is inferred from a service switch. Effective Jev status prioritizes global/operator budget pauses. API contracts, authentication, and moderation requirements are unchanged.

Verification uses synthetic capture images and budget responses. No production moderation, provider configuration, or budget mutation is performed by the design validation.
