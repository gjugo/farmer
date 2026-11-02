import { h } from './dom';

/** Chromium's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'farmer.installDismissedAt';
/** After "Not now" the banner stays away this long. */
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isPhoneOrTablet(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode: it just shows again next time */
  }
}

/** Safari's Share icon: a box with an arrow out of the top. */
function shareIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'install-share');
  svg.setAttribute('aria-label', 'Share');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M12 3v12M8 7l4-4 4 4M8 10H6v11h12V10h-2');
  svg.append(path);
  return svg;
}

/**
 * Offers to install the game as an app on a phone or tablet: an Install button where the browser supports the prompt
 * (Chrome, Edge, Samsung Internet on Android), and the "Share → Add to Home Screen" steps on iOS, which has no prompt.
 * Shows nothing when already running as an installed app or after "Not now" in the last week.
 */
export function mountInstallPrompt(root: HTMLElement): void {
  if (isStandalone() || !isPhoneOrTablet()) return;

  let banner: HTMLElement | null = null;
  const close = (dismissed: boolean): void => {
    if (dismissed) rememberDismissed();
    banner?.remove();
    banner = null;
  };
  const show = (text: (string | Node)[], action: HTMLElement | null): void => {
    if (banner || recentlyDismissed()) return;
    banner = h(
      'div',
      { class: 'install-banner', role: 'dialog', 'aria-label': 'Install Farmer', 'data-testid': 'install-banner' },
      h('img', { class: 'install-icon', src: 'icons/icon-192.png', alt: '' }),
      h('div', { class: 'install-text' }, h('strong', {}, 'Install Farmer'), h('span', {}, ...text)),
      h('div', { class: 'install-actions' }, action, h('button', { type: 'button', class: 'btn btn-secondary', 'data-testid': 'install-later', onclick: () => close(true) }, 'Not now')),
    );
    root.append(banner);
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const prompt = e as BeforeInstallPromptEvent;
    const install = h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'data-testid': 'install-app',
        onclick: async () => {
          close(false);
          await prompt.prompt();
          if ((await prompt.userChoice).outcome === 'dismissed') rememberDismissed();
        },
      },
      'Install',
    );
    show(['Play full screen from your home screen, even offline.'], install);
  });
  window.addEventListener('appinstalled', () => close(false));

  if (isIos()) {
    show(['Tap Share ', shareIcon(), ' in Safari, then “Add to Home Screen”.'], null);
  }
}
