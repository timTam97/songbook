/**
 * The look of the Cognito managed-login pages (sign in, set a new password,
 * reset a password), matched to the site: Tailwind's stone palette, the
 * site's light and dark surfaces, and the songbook's note icon over its title.
 *
 * Cognito lets a style recolour and rearrange these pages but not reword them.
 * The settings mirror the document the console's branding editor exports
 * (DescribeManagedLoginBrandingByClient) key for key, so nothing falls back to
 * Cognito's blue defaults.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Tailwind's colours, as Cognito's RRGGBBAA. */
const tw = {
  white: 'ffffff',
  stone: {
    50: 'fafaf9', 100: 'f5f5f4', 200: 'e7e5e4', 300: 'd6d3d1', 400: 'a8a29e', 500: '78716c',
    600: '57534e', 700: '44403c', 800: '292524', 900: '1c1917', 950: '0c0a09',
  },
  red: { 50: 'fef2f2', 300: 'fca5a5', 400: 'f87171', 700: 'b91c1c', 800: '991b1b', 950: '450a0a' },
  amber: { 50: 'fffbeb', 300: 'fcd34d', 400: 'fbbf24', 700: 'b45309', 800: '92400e', 950: '451a03' },
  emerald: { 50: 'ecfdf5', 300: '6ee7b7', 400: '34d399', 700: '047857', 800: '065f46', 950: '022c22' },
} as const;
const c = (hex: string) => `${hex}ff`;
const { stone: s, red, amber, emerald } = tw;
const white = c(tw.white);

const modes = <L, D>(lightMode: L, darkMode: D) => ({ lightMode, darkMode });

const secondary = modes(
  {
    defaults: { backgroundColor: white, borderColor: c(s[300]), textColor: c(s[800]) },
    hover: { backgroundColor: c(s[100]), borderColor: c(s[300]), textColor: c(s[900]) },
    active: { backgroundColor: c(s[200]), borderColor: c(s[400]), textColor: c(s[900]) },
  },
  {
    defaults: { backgroundColor: c(s[900]), borderColor: c(s[700]), textColor: c(s[200]) },
    hover: { backgroundColor: c(s[800]), borderColor: c(s[700]), textColor: c(s[100]) },
    active: { backgroundColor: c(s[700]), borderColor: c(s[600]), textColor: c(s[50]) },
  },
);

const bar = {
  ...modes({ borderColor: c(s[200]), background: { color: c(s[50]) } }, { borderColor: c(s[800]), background: { color: c(s[900]) } }),
  backgroundImage: { enabled: false },
  logo: { location: 'START', enabled: false },
};

export const LOGIN_BRANDING_SETTINGS = {
  components: {
    primaryButton: modes(
      {
        defaults: { backgroundColor: c(s[900]), textColor: c(s[50]) },
        hover: { backgroundColor: c(s[700]), textColor: c(s[50]) },
        active: { backgroundColor: c(s[700]), textColor: c(s[50]) },
        disabled: { backgroundColor: c(s[200]), borderColor: c(s[200]) },
      },
      {
        defaults: { backgroundColor: c(s[100]), textColor: c(s[900]) },
        hover: { backgroundColor: c(s[300]), textColor: c(s[900]) },
        active: { backgroundColor: c(s[300]), textColor: c(s[900]) },
        disabled: { backgroundColor: c(s[800]), borderColor: c(s[800]) },
      },
    ),
    secondaryButton: secondary,
    idpButton: { standard: secondary, custom: {} },
    // The site's cards: white on stone-50, stone-950 on stone-900.
    form: {
      ...modes({ backgroundColor: white, borderColor: c(s[200]) }, { backgroundColor: c(s[950]), borderColor: c(s[800]) }),
      borderRadius: 8.0,
      backgroundImage: { enabled: false },
      logo: { location: 'CENTER', position: 'TOP', enabled: true, formInclusion: 'IN' },
    },
    pageBackground: { image: { enabled: false }, ...modes({ color: c(s[50]) }, { color: c(s[900]) }) },
    pageText: modes(
      { bodyColor: c(s[700]), headingColor: c(s[900]), descriptionColor: c(s[500]) },
      { bodyColor: c(s[300]), headingColor: c(s[100]), descriptionColor: c(s[400]) },
    ),
    alert: {
      ...modes({ error: { backgroundColor: c(red[50]), borderColor: c(red[300]) } }, { error: { backgroundColor: c(red[950]), borderColor: c(red[800]) } }),
      borderRadius: 6.0,
    },
    favicon: { enabledTypes: ['SVG'] },
    phoneNumberSelector: { displayType: 'TEXT' },
    pageHeader: bar,
    pageFooter: bar,
  },
  componentClasses: {
    buttons: { borderRadius: 6.0 },
    input: {
      ...modes(
        { defaults: { backgroundColor: white, borderColor: c(s[300]) }, placeholderColor: c(s[500]) },
        { defaults: { backgroundColor: c(s[950]), borderColor: c(s[700]) }, placeholderColor: c(s[400]) },
      ),
      borderRadius: 6.0,
    },
    inputLabel: modes({ textColor: c(s[800]) }, { textColor: c(s[200]) }),
    inputDescription: modes({ textColor: c(s[500]) }, { textColor: c(s[400]) }),
    focusState: modes({ borderColor: c(s[900]) }, { borderColor: c(s[100]) }),
    link: modes(
      { defaults: { textColor: c(s[900]) }, hover: { textColor: c(s[600]) } },
      { defaults: { textColor: c(s[100]) }, hover: { textColor: c(s[400]) } },
    ),
    divider: modes({ borderColor: c(s[200]) }, { borderColor: c(s[800]) }),
    optionControls: modes(
      { defaults: { backgroundColor: white, borderColor: c(s[400]) }, selected: { backgroundColor: c(s[900]), foregroundColor: c(s[50]) } },
      { defaults: { backgroundColor: c(s[950]), borderColor: c(s[500]) }, selected: { backgroundColor: c(s[100]), foregroundColor: c(s[900]) } },
    ),
    dropDown: {
      ...modes(
        {
          defaults: { itemBackgroundColor: white },
          hover: { itemBackgroundColor: c(s[100]), itemBorderColor: c(s[400]), itemTextColor: c(s[900]) },
          match: { itemBackgroundColor: c(s[200]), itemTextColor: c(s[900]) },
        },
        {
          defaults: { itemBackgroundColor: c(s[900]) },
          hover: { itemBackgroundColor: c(s[800]), itemBorderColor: c(s[600]), itemTextColor: c(s[100]) },
          match: { itemBackgroundColor: c(s[700]), itemTextColor: c(s[50]) },
        },
      ),
      borderRadius: 6.0,
    },
    statusIndicator: modes(
      {
        success: { backgroundColor: c(emerald[50]), borderColor: c(emerald[300]), indicatorColor: c(emerald[700]) },
        warning: { backgroundColor: c(amber[50]), borderColor: c(amber[300]), indicatorColor: c(amber[700]) },
        error: { backgroundColor: c(red[50]), borderColor: c(red[300]), indicatorColor: c(red[700]) },
        pending: { indicatorColor: 'AAAAAAAA' },
      },
      {
        success: { backgroundColor: c(emerald[950]), borderColor: c(emerald[800]), indicatorColor: c(emerald[400]) },
        warning: { backgroundColor: c(amber[950]), borderColor: c(amber[800]), indicatorColor: c(amber[400]) },
        error: { backgroundColor: c(red[950]), borderColor: c(red[800]), indicatorColor: c(red[400]) },
        pending: { indicatorColor: 'AAAAAAAA' },
      },
    ),
    idpButtons: { icons: { enabled: true } },
  },
  categories: {
    // Follow the browser's light/dark preference, as the site does by default.
    global: { colorSchemeMode: 'DYNAMIC', pageHeader: { enabled: false }, pageFooter: { enabled: false }, spacingDensity: 'REGULAR' },
    form: {
      location: { horizontal: 'CENTER', vertical: 'CENTER' },
      displayGraphics: true,
      instructions: { enabled: false },
      languageSelector: { enabled: false },
      sessionTimerDisplay: 'NONE',
    },
    auth: {
      authMethodOrder: [[{ display: 'BUTTON', type: 'FEDERATED' }, { display: 'INPUT', type: 'USERNAME_PASSWORD' }]],
      federation: { interfaceStyle: 'BUTTON_LIST', order: [] },
    },
    signUp: { acceptanceElements: [{ enforcement: 'NONE', textKey: 'en' }] },
  },
};

/** The site's note icon (web/public/favicon.svg) over the book's title, in the site's serif. */
const logo = (ink: string, paper: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="84" viewBox="0 0 240 84">` +
  `<g transform="translate(100 0) scale(1.25)">` +
  `<rect width="32" height="32" rx="7" fill="#${ink}"/>` +
  `<path d="M12 22.5V9.5l11-2.5v12.5" fill="none" stroke="#${paper}" stroke-width="2.2" stroke-linejoin="round"/>` +
  `<circle cx="9.5" cy="22.5" r="3" fill="#${paper}"/><circle cx="20.5" cy="19.5" r="3" fill="#${paper}"/>` +
  `</g>` +
  `<text x="120" y="76" text-anchor="middle" fill="#${ink}" font-size="24" font-weight="600" letter-spacing="-0.3" ` +
  `font-family="'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif">Melbourne Songs</text>` +
  `</svg>`;

const FAVICON = fileURLToPath(new URL('../../web/public/favicon.svg', import.meta.url));

const svg = (category: string, colorMode: 'LIGHT' | 'DARK', source: string) => ({
  category,
  colorMode,
  extension: 'SVG',
  bytes: Buffer.from(source).toString('base64'),
});

/** The style's images: the logo in each colour mode, and the site's favicon. */
export function loginBrandingAssets() {
  const favicon = readFileSync(FAVICON, 'utf8');
  return [
    svg('FORM_LOGO', 'LIGHT', logo(s[900], s[50])),
    svg('FORM_LOGO', 'DARK', logo(s[100], s[900])),
    svg('FAVICON_SVG', 'LIGHT', favicon),
    svg('FAVICON_SVG', 'DARK', favicon),
  ];
}
