// Shared email branding. The HDS Tech Support logo comes in two inks:
//   LIGHT_BG = dark-navy logo, for light backgrounds (our white email cards)
//   DARK_BG  = white logo, for dark backgrounds (the navy admin-alert header,
//              and dark-mode mail clients)
// On light cards we ship BOTH and swap to the white logo under
// prefers-color-scheme: dark — the one deliberate <style> exception to our
// inline-only email rule (it's the only way to do a dark-mode logo swap).

export const EMAIL_LOGO_LIGHT_BG = 'https://cdn.prod.website-files.com/69d48f8e8f01871806e7f5c4/6a39d7d11152f91b32bf5382_Techsupport-logo-dark.png';
export const EMAIL_LOGO_DARK_BG = 'https://cdn.prod.website-files.com/69d48f8e8f01871806e7f5c4/69dc27e0a29c05f050e62f38_Techsupport-logo.png';

// Drop into <head> for any template that uses emailLogoImgs/emailLogoRow.
export const EMAIL_HEAD_STYLE = `<style>
    @media (prefers-color-scheme: dark) {
      .hds-logo-light { display: none !important; }
      .hds-logo-dark  { display: inline-block !important; }
    }
  </style>`;

// Light-background logo with a dark-mode swap. Clients that strip <style> simply
// keep the dark-navy logo (correct for a white card).
export function emailLogoImgs(height = 30): string {
  return `<img src="${EMAIL_LOGO_LIGHT_BG}" alt="HDS Tech Support" class="hds-logo-light" height="${height}" style="height:${height}px;width:auto;max-width:100%;display:block;border:0;" />`
    + `<img src="${EMAIL_LOGO_DARK_BG}" alt="HDS Tech Support" class="hds-logo-dark" height="${height}" style="height:${height}px;width:auto;max-width:100%;display:none;border:0;" />`;
}

// A full white header row containing the logo (for light-card emails).
export function emailLogoRow(): string {
  return `<tr><td align="left" style="padding:20px 28px;background:#ffffff;border-bottom:1px solid #E2E8EF;">${emailLogoImgs(30)}</td></tr>`;
}

// The white logo only — for a known dark background (e.g. the navy admin header).
export function emailLogoWhite(height = 26): string {
  return `<img src="${EMAIL_LOGO_DARK_BG}" alt="HDS Tech Support" height="${height}" style="height:${height}px;width:auto;max-width:100%;display:block;border:0;" />`;
}
