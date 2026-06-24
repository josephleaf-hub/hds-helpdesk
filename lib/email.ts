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

function escEmail(s: string) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const ROLE_WORD: Record<string, string> = { owner: 'an Owner', admin: 'an Admin', manager: 'a Manager' };

// Branded invite email (dark admin header). The link lets the recipient set their
// own password; we never set or see it.
export function inviteEmailHtml({ name, roleLabel, link }: { name: string; roleLabel: string; link: string }): string {
  const first = (name || '').split(' ')[0] || 'there';
  const roleWord = ROLE_WORD[roleLabel] || `a ${roleLabel}`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>HDS IT Helpdesk invite</title></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="background:#060D18;padding:22px 28px;">
        ${emailLogoWhite(24)}
        <div style="font-size:11px;color:#8A97A8;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;margin-top:14px;">You've been invited</div>
        <div style="font-size:18px;font-weight:600;color:#ffffff;margin-top:4px;">HDS IT Helpdesk</div>
      </td></tr>
      <tr><td style="padding:22px 28px;font-size:14px;line-height:1.6;color:#0F1C2E;">
        <div style="margin-bottom:10px;">Hi ${escEmail(first)},</div>
        <div style="margin-bottom:10px;">You've been added to the HDS IT Helpdesk as ${roleWord}. Use the button below to set your password and finish setting up your account.</div>
        <div style="margin:22px 0 6px;">
          <a href="${link}" style="display:inline-block;background:#1C64F2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">Set your password</a>
        </div>
        <div style="margin-top:16px;color:#6B7280;font-size:13px;">This link is single-use and expires. If it stops working, ask an Owner to resend your invite. You won't have access until you set your password.</div>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#F8F9FA;border-top:1px solid #E2E8EF;font-size:12px;color:#6B7280;line-height:1.5;">
        If you weren't expecting this, you can ignore this email.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// Branded password-reset email (self forgot-password or Owner-initiated reset).
export function resetEmailHtml({ name, link, byOwner = false }: { name: string; link: string; byOwner?: boolean }): string {
  const first = (name || '').split(' ')[0] || 'there';
  const line = byOwner
    ? 'An Owner has reset your HDS IT Helpdesk password. Use the button below to set a new one.'
    : 'We received a request to reset your HDS IT Helpdesk password. Use the button below to set a new one.';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Reset your password</title></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0F1C2E;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="background:#060D18;padding:22px 28px;">
        ${emailLogoWhite(24)}
        <div style="font-size:11px;color:#8A97A8;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;margin-top:14px;">Password reset</div>
        <div style="font-size:18px;font-weight:600;color:#ffffff;margin-top:4px;">HDS IT Helpdesk</div>
      </td></tr>
      <tr><td style="padding:22px 28px;font-size:14px;line-height:1.6;color:#0F1C2E;">
        <div style="margin-bottom:10px;">Hi ${escEmail(first)},</div>
        <div style="margin-bottom:10px;">${line}</div>
        <div style="margin:22px 0 6px;">
          <a href="${link}" style="display:inline-block;background:#1C64F2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">Set a new password</a>
        </div>
        <div style="margin-top:16px;color:#6B7280;font-size:13px;">This link is single-use and expires shortly.${byOwner ? '' : " If you didn't request this, you can ignore this email and your password stays the same."}</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function resetEmailText({ name, link, byOwner = false }: { name: string; link: string; byOwner?: boolean }): string {
  const first = (name || '').split(' ')[0] || 'there';
  return [
    `Hi ${first},`, '',
    byOwner ? 'An Owner has reset your HDS IT Helpdesk password.' : 'We received a request to reset your HDS IT Helpdesk password.',
    'Set a new password:', link, '',
    byOwner ? 'This link is single-use and expires shortly.' : "This link is single-use and expires shortly. If you didn't request this, ignore this email.",
  ].join('\n');
}

export function inviteEmailText({ name, roleLabel, link }: { name: string; roleLabel: string; link: string }): string {
  const first = (name || '').split(' ')[0] || 'there';
  const roleWord = ROLE_WORD[roleLabel] || `a ${roleLabel}`;
  return [
    `Hi ${first},`, '',
    `You've been added to the HDS IT Helpdesk as ${roleWord}.`,
    `Set your password to finish setting up your account:`, link, '',
    `This link is single-use and expires. You won't have access until you set your password.`,
  ].join('\n');
}
