# Admin UI: Bezier foundation

Rules for rebuilding pages with Channel.io Bezier (`@channel.io/bezier-react@3.6.6`, `@channel.io/bezier-icons@0.64.0`).
Reference pages: `pages/Dashboard.tsx` (data page), `pages/Settings.tsx` (sub-navigation + forms), `pages/Channels.tsx`
(row cards), `pages/Login.tsx` (form). Copy their structure.

Ground truth for props is `node_modules/@channel.io/bezier-react/dist/types/components/<Name>/<Name>.types.d.ts`
(the package also ships `src/`, so `src/components/<Name>/<Name>.tsx` and `*.stories.tsx` show real usage).

## Setup (already done, do not repeat)

- `main.tsx` imports `@channel.io/bezier-react/styles.css` **before** `./styles.css` and wraps the app in `ThemeRoot` (`lib/theme.tsx`):
  `AppProvider` (sets `<html data-bezier-theme>`) + `ToastProvider` + theme preference (`useTheme()` → `{ pref, themeName, setPref }`, stored in localStorage `sokuto:theme` = `light | dark | system`).
- Fonts: Inter (cf.channel.io) + Noto Sans JP (Google Fonts) in `admin/index.html`; `styles.css` forces the JP font stack for every Bezier typography token.
- Dark mode is entirely Bezier's: every `--bg-*`, `--txt-*`, `--bdr-*`, `--bgtxt-*` variable switches with the theme. **Never** write `prefers-color-scheme` in CSS and never hard-code colors.
- i18n: `useT()` / `useLang()` from `lib/i18n.ts`. Add new keys to **both** `ja` and `en`. Placeholders are plain `{n}` replaced by the caller (`t('dash_notifications_latest').replace('{n}', …)`).

## CSS gotchas (important)

- Bezier puts its CSS in cascade layers (`@layer tokens, base, components`). **Any unlayered rule in our `styles.css` beats any Bezier rule regardless of specificity.** So never write element selectors (`a`, `input`, `button`, `table`…) unlayered: they would restyle Bezier internals. Element defaults go inside `@layer base { … }` (see top of `styles.css`); custom classes stay unlayered.
- Bezier's base sets `:root { font-size: 62.5% }` → `1rem = 10px`. Use px.
- Bezier class names are hashed; target Bezier internals only through your own `className` or ARIA attributes (`[role='menuitem']`).
- All pages are migrated; the pre-Bezier `LEGACY` block in `styles.css` is gone. Do not reintroduce generic utility classes (`.btn`, `.row`, `.muted`, `.alert`, `.badge`, `.grid`, …): use Bezier components and page-prefixed classes in `pages/<page>.css`.
- Useful variables: surfaces `--bg-white-normal` (cards), `--bg-grey-lightest` (page), `--bg-black-lightest` / `--bg-black-lighter` (subtle fills, hover); text `--txt-black-darkest` / `-darker` / `-dark` (primary / secondary / tertiary); borders `--bdr-black-light`; accents `--bgtxt-{blue,red,green,orange,…}-{lightest,lighter,normal,dark}`; radii `--radius-6/8/12/16/32`; shadows `--ev-1…6`; mono `--font-family-mono`.

## Shell and layout rules (Channel.io desk style)

Direction: white surfaces on the grey canvas (`--bg-grey-lightest`), 1px `--bdr-black-light` rules, dense rows, **one blue
primary action per screen**. Radii: surfaces `--radius-8`, chips `--radius-6` (pill chips `--radius-32`), modals/sheets
`--radius-12`. Shadows only on floating things (dropdowns, sheets): `--ev-2/3`. No entrance animations.

- **Shell** (`App.tsx`, `styles.css` "shell"): 220px white sidebar (`--sidebar-width`) = brand row (link to `/`, the
  dashboard/home) → `WorkspaceSwitcher` → nav (受信箱 first, with the unread `.nav-count` badge, then 連絡先 / 自動化 /
  一斉配信 / レポート / チャネル接続 / 設定) → footer (theme + language, sign out). Nav items are Bezier `NavItem`, 34px.
  Mobile (≤ 860px): sticky top bar 52px (brand, switcher, menu button → bottom sheet with prefs + sign out) and a 44px
  horizontally scrolling nav row. `--shell-top` is the height of that sticky chrome (0 on desktop, 97px on mobile):
  use it for full-height pages (`calc(100dvh - var(--shell-top) - …)`).
- **Workspace**: `useWorkspaces()` (`lib/workspace.ts`) → `{ workspaces, current, unread, reload }`. Every `api.*` call
  already sends `X-Workspace` (and the `sokuto_ws` cookie covers plain links such as the CSV export); never add it by
  hand. `switchWorkspace(id)` reloads the tab into the same section. Show the workspace name where the page is about
  the workspace (dashboard title).
- **Page**: the shell gives 24px side padding (16 on mobile) and **no max width**. A page returns `<div className="stack">`
  whose first child is `<PageHeader title description? actions? />`: a full-bleed 56px white band with a bottom rule
  (sticky on desktop), title 18 bold (the only `<h1>`), `description` inline after the title (badges, counts),
  `actions` right-aligned (at most one primary button; others `secondary` + `monochrome-dark`). The band's margin plus
  the stack gap give 24px to the first section. Full-height pages: band 56 + 8 + gap 16 + bottom padding 24 = 104px
  (`calc(100dvh - var(--shell-top) - 104px)`). The inbox goes further and bleeds to the shell edges under the band
  (`margin: -24px calc(-1 * var(--page-pad-x)) -24px; height: calc(100dvh - var(--shell-top) - var(--header-height))`,
  see `.ibx` in `inbox.css`): Channel.io's panes divided by 1px rules, no outer card.
- **Width caps** only where reading/forms need it: Settings content column 720px; forms inside wide rows 720px
  (`.ch-row__body form`). Lists, tables and stat tiles use the full width.
- **Sub-navigation** (Settings): 200px column of `NavItem`s with icons (`.st-subnav`), sticky under the header; the
  section lives in the URL hash (`/settings#workspaces`) so links and Back work. At ≤ 860px it becomes a horizontal row
  of pill chips (text only) that scrolls inside itself. Reuse the pattern (and the CSS) for any page with sections.
- **Rows instead of card grids**: for a handful of configurable things (channels), use full-width row cards
  (`.ch-row`: 36px tinted icon, name 14 bold + one-line account, status `Badge`, `secondary` s toggle with
  `aria-expanded`/`aria-controls`; the body expands below a rule, no animation).
- **Density**: list rows 56px (`.st-ws`), table rows ~44px, nav items 34px, chips 32px with 8px gaps. Spacing scale
  4 · 8 · 12 · 16 · 24. Text: 13 body, 14 emphasized, 12 meta, 16/18 headings; tabular figures for numbers.
- **Chips** (filters, section switches): `<div className="filter-chips" role="group" aria-label>` of
  `<button className="filter-chip" aria-pressed>` (optional `.filter-chip__count`; add `filter-chips--scroll` for one
  row that scrolls inside itself), or for a filter with many values a chip-styled select:
  `<SelectInput className={value ? 'filter-select is-set' : 'filter-select'} …/>` (inbox filters, report periods,
  contacts toolbar). Not `SegmentedControl` when there are more than 3 options or labels differ in length.
- **Hover** effects only inside `@media (hover: hover)`, 120ms `ease`, `transform`/`opacity`/colors only; never
  `transition: all`. The only custom motion is the sheet/drawer slide (`.sheet` and `.drawer`: 220ms
  `var(--ease-drawer)`, fade only under `prefers-reduced-motion`). Dropdowns, modals, toasts and button presses are
  Bezier's own.
- **Drawers** (forms that keep the list visible, e.g. 新しい配信): `<Drawer show onHide title footer? width? sheetOnMobile?>`.
  It is a Bezier Modal pinned to the right (420px, full width ≤ 860px, or a bottom sheet with `sheetOnMobile`), so
  Bezier dropdowns and toasts work inside it (a native `<dialog>` puts them behind the top layer); focus goes to the
  first field, Esc / scrim / × close it, focus returns to the opener. Put a form's submit in `footer` with
  `form="<form id>"`.
- Sections are `<Card title? actions? flush?>` (white, 1px rule, `--radius-8`, renders `<h2>`). KPI tiles: `StatCard`
  in `.stat-grid` (fills the row; `value` may be a string such as `99+` or `—`).
- Loading: `if (!data) return error ? <ErrorBanner …/> : <LoadingState />` (first load). **Never** leave a page stuck on "loading" when the request fails: keep an `error` state and render `<ErrorBanner error={err} onRetry={load} />` (with `<PageHeader>` above it).
- Empty data: `<EmptyState icon={…Icon} title=… description? action? compact? />` (use `compact` inside a Card). An empty state says what to do next and offers the button.
- Errors from actions (save, delete…): `ErrorBanner` near the form for validation/API errors; **toasts** for one-shot feedback: `const toast = useToast(); toast.addToast(t('saved'), { preset: 'success' })` (preset `'success' | 'error' | 'default'`). Note the method is **`addToast`**, not `add`. Name the toast after the action (追加 → 「…を追加しました」).
- Confirm destructive actions with `ConfirmModal` (see below), not `window.confirm`.
- Tables: `<Card flush><DataTable columns rows rowKey onRowClick? empty={<EmptyState compact …/>} /></Card>`. Columns: `{ key, header, render, width?, numeric?, nowrap?, hideOnMobile? }`. It scrolls horizontally inside itself; the page must never scroll sideways.
- Lists of rows that are not tabular: `<Card flush><div className="list">{items.map(… <ListItem …/>)}</div></Card>` (see Dashboard). Long user text inside list content: wrap in `<span className="list-text">` (has `overflow-wrap:anywhere`).
- Names of contacts: always `<ContactName contact={c} />` (displayName → `@username` → channel + middle-truncated id). Plain-text variant: `contactDisplayName(c)`. Truncated names carry a `title`.
- Dates: `<RelativeTime value={iso} />` for "x 分前"; `formatDateTime(lang, v)` for absolute. Numbers: `formatNumber(lang)(n)`; counts in tables/cards must use tabular figures (`numeric` column, `StatCard`, or `.tabular`). Counts that hit an API cap: `countLabel(n)` → `99+`.
- Chat UI (Inbox, test panel): `.bubble.in` / `.bubble.out`, failed sends add `.failed` (red tones, keep the error text visible in `.meta`), quick replies `.chips > button.chip`. The inbox wraps each bubble in `.ibx-msg--in|bot|human|system` with the time/sender line under it, bot replies are white with a hairline (`.ibx-bubble--bot`), team replies blue, system events centered grey text, and date separators (`.ibx-day`) split the thread by local day.
- Mobile (≤ 860px): never use fixed widths > 340px, let action rows wrap (`PageHeader` does), two-column layouts collapse to one column at 860px, use `hideOnMobile` only for secondary table columns. Test at 390px with `?data=worst`.
- Dev data: run `npm run dev:ui` and add `?data=worst|empty|one|huge` (see `lib/devFixtures.ts`; `/api/workspaces` has a 12-workspace worst case whose current name is 60 characters). The toggle at the bottom is dev-only.

## Shared components (`import { … } from '../components'`)

| Component | Notes |
|---|---|
| `PageHeader` | 56px header band: `title`, `description?` (inline badges/counts), `actions?` (buttons, one primary). |
| `Card` | `title?`, `actions?`, `flush?` (no padding; header gets a divider), `className?`. |
| `EmptyState` | `icon` (BezierIcon), `title`, `description?`, `action?`, `compact?`. |
| `ErrorBanner` | `error` (unknown → `errorMessage()`), `onRetry?` adds an inline "再試行". |
| `LoadingState` | centered Spinner; `compact?` for inside cards. |
| `ChannelBadge` | `channel` ('line' / 'messenger' / 'instagram' / 'any' / other), `size?`. `useChannelLabel()` for plain text. |
| `BotStatusBadge` | `on: boolean`. |
| `StatCard` | `label`, `value: number \| string`, `hint?`. Put in `<div className="stat-grid">`. |
| `DataTable` | see above. Generic: `DataTable<Row>`. |
| `TextInputField` / `TextAreaField` | `label`, `helperText?`, `error?`, `help?`, `required?`, `disabled?` + all TextField/TextArea props (`value`, `onChange(e)`, `type`, `placeholder`, `size`…). |
| `SelectField` / `SelectInput` | `value`, `options: {value,label}[]`, `onChange(value)`, `placeholder?`. Bezier Select is a button + dropdown of ListItems, not a native `<select>`. `SelectInput` has no label (filters/toolbars; pass `aria-label`). |
| `CopyBox` | `value`, `label?`. Mono value + Copy button + toast. |
| `ContactName` | `contact: { id?, channel?, displayName, username?, channelUserId? }`, `typo?`, `bold?`. Truncates to one line: parent needs `min-width: 0`. |
| `ContactAvatar` | `contact: { id, channel?, displayName, username?, avatarUrl? }`, `size?: 24 \| 36`. Image, else initials on a tint by id; at 36 a `ChannelDot` (LINE / Messenger / Instagram mark, labelled) sits on the corner. |
| `Drawer` / `ModalCloseButton` | See "Drawers" above. `ModalCloseButton` replaces Bezier's `showCloseIcon` (whose × has no accessible name): last child of `ModalContent`, the header gets `className="modal-head"`. |
| `useCopy()` | `copy(text)` → clipboard + "コピーしました" toast (CopyBox uses it). |
| `RelativeTime` | `value`, `maxDays?` (default 7, then absolute date). |
| `SokutoMark` | brand SVG, `size?`. |
| `WorkspaceSwitcher` | shell only. `WorkspaceAvatar` (`workspace`, `size?`: initial on a tint chosen by id), `AddWorkspaceModal` (`show`, `onHide`, `onCreated(ws)`). |
| `formatNumber(lang)(n)`, `formatDateTime(lang, v)`, `formatRelative(lang, v)`, `middleTruncate(s)` | from `components/format.ts`. |

## Bezier components (verified against the 3.6.6 types)

Import from `@channel.io/bezier-react`; icons from `@channel.io/bezier-icons` (`grep -o "[A-Za-z]*Icon\b" node_modules/@channel.io/bezier-icons/dist/index.d.ts | sort -u`). Size enums differ per component: check before use.

- `Button` — `text?` (string only; omit for icon-only and pass `aria-label`), `styleVariant: 'primary'|'secondary'|'tertiary'|'floating'|'floating-alt'`, `colorVariant: 'blue'|'red'|'green'|'cobalt'|'orange'|'pink'|'purple'|'monochrome-light'|'monochrome-dark'`, `size: 'xs'|'s'|'m'|'l'|'xl'`, `leftContent/rightContent` (BezierIcon or node), `loading`, `disabled`, `type` (default `'button'`; set `'submit'` in forms). Conventions: page primary action = default (primary blue) `m`; secondary = `styleVariant="secondary" colorVariant="monochrome-dark"`; destructive = `colorVariant="red"`; in-card small actions `size="s"`.
- `Text` — `typo: '11'|'12'|'13'|'14'|'15'|'16'|'17'|'18'|'22'|'24'|'30'|'36'`, `bold`, `color` (semantic token name, e.g. `'txt-black-darker'`, `'bgtxt-red-normal'`, beta `'text-neutral-light'`), `truncated` (true or line count), `as` (renders `<span>` by default), `align`, margin props.
- `Badge` / `Tag` — `size: 'xs'|'s'|'m'|'l'`, `variant: 'default'|'monochrome-light'|'monochrome-dark'|'blue'|'cobalt'|'teal'|'green'|'olive'|'pink'|'navy'|'yellow'|'orange'|'red'|'purple'`; Badge has `icon?`; Tag has `onDelete?` (shows ×).
- `Banner` — **`icon` is required** (BezierIcon or `null`), `variant: 'default'|'blue'|'cobalt'|'green'|'orange'|'red'|'alt'`, `content`, `hasLink` + `linkText` + `renderLink={({content}) => <Link …>{content}</Link>}` (default link opens a new tab!), `actionIcon` + `onClickAction` (icon-only button with no label; prefer `renderLink` for actions).
- `ListItem` — `content`, `description?`, `leftContent?` (icon or node), `rightContent?`, `size: 'xs'|'s'|'m'|'l'`, `variant`, `active`, `disabled`, `onClick` (renders a button). **`href` always opens in a new tab (`target=_blank`)**: for in-app navigation use `onClick={() => navigate(to)}`. String `content` is truncated to one line; pass a node (`<span className="list-text">`) to wrap.
- `NavItem` — renders `<li><a role=menuitem>`; must be inside `<ul role="menu">`. `name` (required), `content`, `href`, `leftContent` (BezierIcon only; the 20px icon slot is always reserved, so give every item an icon), `rightContent`, `active`, `onClick(e, name)`. Used by the shell and sub-navigations; pass `aria-current="page"` on the active one.
- `FormControl` / `FormLabel` / `FormHelperText` / `FormErrorMessage` — FormControl props `hasError`, `required`, `disabled`, `readOnly`, `size: 'xl'|'l'|'m'|'xs'`, `labelPosition: 'top'|'left'`; it wires ids/aria to the child field. `FormErrorMessage` is shown only when `hasError`. Prefer our `TextInputField` etc.
- `TextField` — `value`, `onChange(e)`, `type: 'search'|'text'|'email'|'password'|'tel'|'url'|'hidden'|'number'`, `size: 'xl'|'l'|'m'|'xs'` (no `s`!), `variant: 'primary'|'secondary'`, `allowClear`, `leftContent` (`{ icon }` object or element), `hasError`.
- `TextArea` — auto-grows; `minRows`/`maxRows` must be one of `3|6|10|16|24|36`.
- `Select` — `text` (shown value), `placeholder`, `size`, children = dropdown content (ListItems); close it via `ref.current.handleHideDropdown()`. Use `SelectField`/`SelectInput`.
- `Switch` — `checked`, `onCheckedChange(boolean)`, `size: 'm'|'s'`. `Checkbox` — `checked` (`boolean | 'indeterminate'`), `onCheckedChange`, children = label, `size: 's'|'m'`.
- `RadioGroup` + `Radio` — `value`, `onValueChange`, `direction`, `spacing`; `Radio` `value` + children label.
- `SegmentedControl` + `SegmentedControlItem` — `type="radiogroup"` (or `"tabs"` with `SegmentedControlTabList` / `SegmentedControlTabContent`), `value`, `onValueChange(v)`, `size: 'xs'|'s'|'m'|'l'`, `width`. Items are equal width; give a `width` when labels differ in length. Item `value` must be non-empty.
- `Tabs` + `TabList` (`size: 'l'|'m'|'s'`) + `TabItems` + `TabItem value` + `TabContent value`; `Tabs` takes `value`/`onValueChange`.
- `Modal` + `ModalContent` (`width`; not `showCloseIcon`, whose × has no label: use `ModalCloseButton`) + `ModalHeader` (**`title` required**, `subtitle?`, `description?`) + `ModalBody` + `ModalFooter` (`leftContent`/`rightContent`) + `ModalClose` (wraps a button). Controlled with `show` + `onHide`.
- `ConfirmModal` + `ConfirmModalContent` / `ConfirmModalHeader` (`title`, `description?`) / `ConfirmModalBody` / `ConfirmModalFooter` / `ConfirmModalClose`: same API as Modal, for "本当に削除しますか?".
- `Tooltip` — `content`, `placement` (e.g. `'top-center'`), child must be a single element. `Help` — `?` icon with tooltip text as children.
- `Spinner` — `size: 'xl'|'l'|'m'|'s'|'xs'`, `color`. `Icon` — `source` (BezierIcon), `size: 'xl'|'l'|'m'|'s'|'xs'|'xxs'|'xxxs'`, `color`.
- `Stack` / `HStack` / `VStack` — `spacing` (px), `align`, `justify: 'start'|'center'|'end'|'stretch'|'between'`, `wrap`, `as` (e.g. `<VStack as="form" spacing={16} onSubmit={…}>`), layout props (`padding`, `width`, …). `Box`, `Center` similar.
- `Divider` — `withoutIndent`, `orientation`. `KeyValueItem` — `keyIcon`, `keyContent`, children = value, `actions`. `ProgressBar`, `Avatar` (`name` required, `size: '20'|'24'|'30'|'36'|'42'|'48'|'72'|'90'|'120'` as strings), `Status` (`type` required).
- `VisuallyHidden` — child must be a single **element** (wrap text in `<span>`).
- `useToast()` — returns `{ addToast, updateToast, removeToast, removeAllToasts }`. Options: `preset`, `appearance`, `icon`, `autoDismiss`.
