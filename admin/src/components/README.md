# Admin UI: Bezier foundation

Rules for rebuilding pages with Channel.io Bezier (`@channel.io/bezier-react@3.6.6`, `@channel.io/bezier-icons@0.64.0`).
Reference pages: `pages/Dashboard.tsx` (data page), `pages/Login.tsx` (form). Copy their structure.

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
- `styles.css` has a `LEGACY` block at the bottom for pages not migrated yet. Do not use those classes (`.btn`, `.row`, `.muted`, `.alert`, `.badge`, `.grid`, `.page-title`, `.inline-fields`, `.code-box`, `.list-item`, `.step-card`, `.conv*`, `.editor`, `.bar`, …) in new code; delete a legacy rule when the last page using it is migrated.
- Useful variables: surfaces `--bg-white-normal` (cards), `--bg-grey-lightest` (page), `--bg-black-lightest` / `--bg-black-lighter` (subtle fills, hover); text `--txt-black-darkest` / `-darker` / `-dark` (primary / secondary / tertiary); borders `--bdr-black-light`; accents `--bgtxt-{blue,red,green,orange,…}-{lightest,lighter,normal,dark}`; radii `--radius-6/8/12/16/32`; shadows `--ev-1…6`; mono `--font-family-mono`.

## Layout rules

- Spacing scale: **4 · 8 · 12 · 16 · 24 · 32 px**. Between page sections: 16 (`.stack`). Inside cards: 16 padding, 12 between header and body. Form fields: `VStack spacing={16}`. Inline groups (badges, buttons): 6–8.
- A page returns `<div className="stack">` whose **first child is `<PageHeader title actions? description? />`** (the only `<h1>`). Sections are `<Card title? actions? flush?>` (renders `<h2>`). The shell (`App.tsx`) already provides page padding and max width (1200px); do not add outer padding.
- Loading: `if (!data) return error ? <ErrorBanner …/> : <LoadingState />` (first load). **Never** leave a page stuck on "loading" when the request fails: keep an `error` state and render `<ErrorBanner error={err} onRetry={load} />` (with `<PageHeader>` above it).
- Empty data: `<EmptyState icon={…Icon} title=… description? action? compact? />` (use `compact` inside a Card).
- Errors from actions (save, delete…): `ErrorBanner` near the form for validation/API errors; **toasts** for one-shot feedback: `const toast = useToast(); toast.addToast(t('saved'), { preset: 'success' })` (preset `'success' | 'error' | 'default'`). Note the method is **`addToast`**, not `add`.
- Confirm destructive actions with `ConfirmModal` (see below), not `window.confirm`.
- Tables: `<Card flush><DataTable columns rows rowKey onRowClick? empty={<EmptyState compact …/>} /></Card>`. Columns: `{ key, header, render, width?, numeric?, nowrap?, hideOnMobile? }`. It scrolls horizontally inside itself; the page must never scroll sideways.
- Lists of rows that are not tabular: `<Card flush><div className="list">{items.map(… <ListItem …/>)}</div></Card>` (see Dashboard). Long user text inside list content: wrap in `<span className="list-text">` (has `overflow-wrap:anywhere`).
- Names of contacts: always `<ContactName contact={c} />` (displayName → `@username` → channel + middle-truncated id). Plain-text variant: `contactDisplayName(c)`.
- Dates: `<RelativeTime value={iso} />` for "x 分前"; `formatDateTime(lang, v)` for absolute. Numbers: `formatNumber(lang)(n)`; counts in tables/cards must use tabular figures (`numeric` column, `StatCard`, or `.tabular`).
- Chat UI (Inbox, test panel): `.bubble.in` / `.bubble.out`, failed sends add `.failed` (red tones, keep the error text visible in `.meta`), quick replies `.chips > button.chip`.
- Mobile (≤ 860px): the sidebar is already a top bar. In pages: never use fixed widths > 340px, let action rows wrap (`PageHeader` does), two-column layouts collapse to one column at 860px, use `hideOnMobile` only for secondary table columns. Test at 390px with `?data=worst`.
- Dev data: run `npm run dev:ui` and add `?data=worst|empty|one|huge` (see `lib/devFixtures.ts`). The toggle at the bottom is dev-only.

## Shared components (`import { … } from '../components'`)

| Component | Notes |
|---|---|
| `PageHeader` | `title`, `description?` (badges/counts), `actions?` (buttons). |
| `Card` | `title?`, `actions?`, `flush?` (no padding; header gets a divider), `className?`. |
| `EmptyState` | `icon` (BezierIcon), `title`, `description?`, `action?`, `compact?`. |
| `ErrorBanner` | `error` (unknown → `errorMessage()`), `onRetry?` adds an inline "再試行". |
| `LoadingState` | centered Spinner; `compact?` for inside cards. |
| `ChannelBadge` | `channel` ('line' / 'messenger' / 'instagram' / 'any' / other), `size?`. `useChannelLabel()` for plain text. |
| `BotStatusBadge` | `on: boolean`. |
| `StatCard` | `label`, `value: number`, `hint?`. Put in `<div className="stat-grid">`. |
| `DataTable` | see above. Generic: `DataTable<Row>`. |
| `TextInputField` / `TextAreaField` | `label`, `helperText?`, `error?`, `help?`, `required?`, `disabled?` + all TextField/TextArea props (`value`, `onChange(e)`, `type`, `placeholder`, `size`…). |
| `SelectField` / `SelectInput` | `value`, `options: {value,label}[]`, `onChange(value)`, `placeholder?`. Bezier Select is a button + dropdown of ListItems, not a native `<select>`. `SelectInput` has no label (filters/toolbars; pass `aria-label`). |
| `CopyBox` | `value`, `label?`. Mono value + Copy button + toast. |
| `ContactName` | `contact: { id?, channel?, displayName, username?, channelUserId? }`, `typo?`, `bold?`. Truncates to one line: parent needs `min-width: 0`. |
| `RelativeTime` | `value`, `maxDays?` (default 7, then absolute date). |
| `SokutoMark` | brand SVG, `size?`. |
| `formatNumber(lang)(n)`, `formatDateTime(lang, v)`, `formatRelative(lang, v)`, `middleTruncate(s)` | from `components/format.ts`. |

## Bezier components (verified against the 3.6.6 types)

Import from `@channel.io/bezier-react`; icons from `@channel.io/bezier-icons` (`grep -o "[A-Za-z]*Icon\b" node_modules/@channel.io/bezier-icons/dist/index.d.ts | sort -u`). Size enums differ per component: check before use.

- `Button` — `text?` (string only; omit for icon-only and pass `aria-label`), `styleVariant: 'primary'|'secondary'|'tertiary'|'floating'|'floating-alt'`, `colorVariant: 'blue'|'red'|'green'|'cobalt'|'orange'|'pink'|'purple'|'monochrome-light'|'monochrome-dark'`, `size: 'xs'|'s'|'m'|'l'|'xl'`, `leftContent/rightContent` (BezierIcon or node), `loading`, `disabled`, `type` (default `'button'`; set `'submit'` in forms). Conventions: page primary action = default (primary blue) `m`; secondary = `styleVariant="secondary" colorVariant="monochrome-dark"`; destructive = `colorVariant="red"`; in-card small actions `size="s"`.
- `Text` — `typo: '11'|'12'|'13'|'14'|'15'|'16'|'17'|'18'|'22'|'24'|'30'|'36'`, `bold`, `color` (semantic token name, e.g. `'txt-black-darker'`, `'bgtxt-red-normal'`, beta `'text-neutral-light'`), `truncated` (true or line count), `as` (renders `<span>` by default), `align`, margin props.
- `Badge` / `Tag` — `size: 'xs'|'s'|'m'|'l'`, `variant: 'default'|'monochrome-light'|'monochrome-dark'|'blue'|'cobalt'|'teal'|'green'|'olive'|'pink'|'navy'|'yellow'|'orange'|'red'|'purple'`; Badge has `icon?`; Tag has `onDelete?` (shows ×).
- `Banner` — **`icon` is required** (BezierIcon or `null`), `variant: 'default'|'blue'|'cobalt'|'green'|'orange'|'red'|'alt'`, `content`, `hasLink` + `linkText` + `renderLink={({content}) => <Link …>{content}</Link>}` (default link opens a new tab!), `actionIcon` + `onClickAction` (icon-only button with no label; prefer `renderLink` for actions).
- `ListItem` — `content`, `description?`, `leftContent?` (icon or node), `rightContent?`, `size: 'xs'|'s'|'m'|'l'`, `variant`, `active`, `disabled`, `onClick` (renders a button). **`href` always opens in a new tab (`target=_blank`)**: for in-app navigation use `onClick={() => navigate(to)}`. String `content` is truncated to one line; pass a node (`<span className="list-text">`) to wrap.
- `NavItem` — renders `<li><a role=menuitem>`; must be inside `<ul role="menu">`. `name` (required), `content`, `href`, `leftContent` (BezierIcon only), `active`, `onClick(e, name)`. Used by the shell only.
- `FormControl` / `FormLabel` / `FormHelperText` / `FormErrorMessage` — FormControl props `hasError`, `required`, `disabled`, `readOnly`, `size: 'xl'|'l'|'m'|'xs'`, `labelPosition: 'top'|'left'`; it wires ids/aria to the child field. `FormErrorMessage` is shown only when `hasError`. Prefer our `TextInputField` etc.
- `TextField` — `value`, `onChange(e)`, `type: 'search'|'text'|'email'|'password'|'tel'|'url'|'hidden'|'number'`, `size: 'xl'|'l'|'m'|'xs'` (no `s`!), `variant: 'primary'|'secondary'`, `allowClear`, `leftContent` (`{ icon }` object or element), `hasError`.
- `TextArea` — auto-grows; `minRows`/`maxRows` must be one of `3|6|10|16|24|36`.
- `Select` — `text` (shown value), `placeholder`, `size`, children = dropdown content (ListItems); close it via `ref.current.handleHideDropdown()`. Use `SelectField`/`SelectInput`.
- `Switch` — `checked`, `onCheckedChange(boolean)`, `size: 'm'|'s'`. `Checkbox` — `checked` (`boolean | 'indeterminate'`), `onCheckedChange`, children = label, `size: 's'|'m'`.
- `RadioGroup` + `Radio` — `value`, `onValueChange`, `direction`, `spacing`; `Radio` `value` + children label.
- `SegmentedControl` + `SegmentedControlItem` — `type="radiogroup"` (or `"tabs"` with `SegmentedControlTabList` / `SegmentedControlTabContent`), `value`, `onValueChange(v)`, `size: 'xs'|'s'|'m'|'l'`, `width`. Items are equal width; give a `width` when labels differ in length. Item `value` must be non-empty.
- `Tabs` + `TabList` (`size: 'l'|'m'|'s'`) + `TabItems` + `TabItem value` + `TabContent value`; `Tabs` takes `value`/`onValueChange`.
- `Modal` + `ModalContent` (`width`, `showCloseIcon`) + `ModalHeader` (**`title` required**, `subtitle?`, `description?`) + `ModalBody` + `ModalFooter` (`leftContent`/`rightContent`) + `ModalClose` (wraps a button). Controlled with `show` + `onHide`.
- `ConfirmModal` + `ConfirmModalContent` / `ConfirmModalHeader` (`title`, `description?`) / `ConfirmModalBody` / `ConfirmModalFooter` / `ConfirmModalClose`: same API as Modal, for "本当に削除しますか?".
- `Tooltip` — `content`, `placement` (e.g. `'top-center'`), child must be a single element. `Help` — `?` icon with tooltip text as children.
- `Spinner` — `size: 'xl'|'l'|'m'|'s'|'xs'`, `color`. `Icon` — `source` (BezierIcon), `size: 'xl'|'l'|'m'|'s'|'xs'|'xxs'|'xxxs'`, `color`.
- `Stack` / `HStack` / `VStack` — `spacing` (px), `align`, `justify: 'start'|'center'|'end'|'stretch'|'between'`, `wrap`, `as` (e.g. `<VStack as="form" spacing={16} onSubmit={…}>`), layout props (`padding`, `width`, …). `Box`, `Center` similar.
- `Divider` — `withoutIndent`, `orientation`. `KeyValueItem` — `keyIcon`, `keyContent`, children = value, `actions`. `ProgressBar`, `Avatar` (`name` required, `size: '20'|'24'|'30'|'36'|'42'|'48'|'72'|'90'|'120'` as strings), `Status` (`type` required).
- `VisuallyHidden` — child must be a single **element** (wrap text in `<span>`).
- `useToast()` — returns `{ addToast, updateToast, removeToast, removeAllToasts }`. Options: `preset`, `appearance`, `icon`, `autoDismiss`.
