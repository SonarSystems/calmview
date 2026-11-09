# @mono/cross-promo

Suggests the maker's other Chrome extensions inside each extension's own pages, to win installs from
people who already like one of them:

- **Popup / side panel:** one card, "From the maker of Calmview", with icon, one-line pitch, rating and
  users once published, and an **Add to Chrome** button. It appears two days after install, never on
  a web page. People can dismiss it (that suggestion is gone for 60 days) or turn it off.
- **Settings:** a "More from Sonar Systems" grid of every other extension, plus the on/off switch.
- Extensions the person already has are never suggested: each extension answers a
  `cross-promo:ping` from its siblings.
- Shared tags (`promo.config.json`) put the most relevant extension first; the rest rotate daily.
- Every button links to the Web Store with `utm_source=<extension>&utm_medium=extension&utm_campaign=cross-promo-popup|settings`,
  so the Web Store dashboard shows which extension sent each visit.
- Nothing is fetched at run time and no permissions are added: the catalogue (with icons) is
  bundled when each extension is built.

## When you publish an extension

1. Paste its Web Store URL into `promo.config.json` (keyed by its folder name in `experiments/`).
2. `pnpm --filter @mono/cross-promo refresh`: reads each listing (store name, summary, icon,
   rating, users) into `src/catalogue.json`.
3. Rebuild and re-upload the other extensions so their copies of the catalogue include it.

Store builds (`pnpm package`) only suggest published extensions. Development builds also show
unpublished ones (their button opens a Web Store search) so the design can be checked now.

There's no "seller page" to read: the Chrome Web Store has no public page that lists a developer's
extensions (checked 7 Nov 2026), so the list comes from the monorepo plus each extension's own listing.

## Use

```ts
import { mountPromo } from "@mono/cross-promo";                         // popup / settings
mountPromo({ self: "2026-11-hush", variant: "card", preview: !__STORE__ });
mountPromo({ self: "2026-11-hush", variant: "grid", parent: section, preview: !__STORE__ });
import { listenForPromoPings } from "@mono/cross-promo/background";     // service worker
listenForPromoPings();
```

New extensions get all of this from `templates/ext`.

## Tests

`pnpm --filter @mono/cross-promo test` (picking, links, listing parser) and, after building every
extension, `pnpm --filter @mono/cross-promo test:e2e`: every extension's card and grid in light and
dark (contrast, icon size, overflow), self never suggested, UTM links, and dismiss.
