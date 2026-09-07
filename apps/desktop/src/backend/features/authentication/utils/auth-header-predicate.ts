export const HEADER_RENDERED_PREDICATE = `(() => {
  const els = Array.from(document.querySelectorAll('button, a'));
  const hasAuthButton = els.some((el) => /^\\s*(Sign\\s*In|Log\\s*In|Sign\\s*Up)\\s*$/i.test((el.textContent || '').trim()));
  const navButtons = Array.from(document.querySelectorAll('nav button'));
  const hasIconOnlyAccountControl = navButtons.length >= 3 && navButtons.some((button, index) =>
    index === navButtons.length - 1 && !(button.textContent || '').trim() && !!button.querySelector('svg')
  );
  const hasAvatar =
    !!document.querySelector('header img[alt][src*="profile"], nav img[alt][src*="profile"]') ||
    !!document.querySelector('header img[alt][src*="default-avatar"], nav img[alt][src*="default-avatar"]') ||
    !!document.querySelector('button[aria-haspopup="menu"]') ||
    !!document.querySelector('[data-testid*="user"]') ||
    hasIconOnlyAccountControl;
  return hasAuthButton || hasAvatar;
})()`;
