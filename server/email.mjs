const footer = 'BusTrackr, a student project of BEI at Valley Christian Schools';
const font = 'font-family:Arial,Helvetica,sans-serif';
const escape = value => String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

// Tables and inline styles only: Gmail drops <style> blocks, and both Gmail and Apple Mail may block remote assets.
export function renderEmail({subject, paragraphs, button = null}) {
  const text = [...paragraphs, ...(button ? [`${button.label}: ${button.url}`] : []), footer].join('\n\n');
  const body = paragraphs.map(paragraph => `<p style="margin:0 0 16px;${font};font-size:16px;line-height:1.5;color:#003360">${escape(paragraph)}</p>`).join('');
  const action = button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px"><tr><td style="background:#003360;border-radius:6px">`
    + `<a href="${escape(button.url)}" style="display:inline-block;padding:13px 24px;${font};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">${escape(button.label)}</a>`
    + `</td></tr></table><p style="margin:0 0 16px;${font};font-size:13px;line-height:1.5;color:#4d4f53">Button not working? Paste this link into your browser:<br><a href="${escape(button.url)}" style="color:#003360;word-break:break-all">${escape(button.url)}</a></p>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escape(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:#eef7fc"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef7fc"><tr><td align="center" style="padding:32px 16px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-top:6px solid #003360">`
    + `<tr><td style="padding:28px 32px 12px;${font};font-size:20px;font-weight:bold;color:#003360">BusTrackr</td></tr>`
    + `<tr><td style="padding:0 32px 16px">${body}${action}</td></tr>`
    + `<tr><td style="padding:16px 32px;background:#f4f6f8;${font};font-size:13px;line-height:1.5;color:#4d4f53">${escape(footer)}</td></tr>`
    + '</table></td></tr></table></body></html>';
  return {subject, text, html};
}

export function createMailer({apiKey, from, fetchImpl = fetch}) {
  return async (to, email) => {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15_000), redirect: 'error',
      headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({from, to: [to], ...email}),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Resend request failed');
  };
}
