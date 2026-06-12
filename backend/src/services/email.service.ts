import nodemailer from 'nodemailer';

/**
 * Serviço de e-mail. Usa SMTP quando as variáveis de ambiente estão configuradas.
 * Em desenvolvimento sem SMTP, loga o conteúdo no console.
 *
 * Variáveis necessárias:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Compatível com Gmail, Resend (smtp.resend.com), Mailgun, Brevo etc.
 */

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

function isSmtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendMail(opts: SendMailOptions): Promise<void> {
  const from = process.env.SMTP_FROM ?? `Meta Ads Agent <noreply@meta-ads-agent.com>`;

  if (!isSmtpConfigured()) {
    // Desenvolvimento: imprime no console em vez de enviar
    console.log('\n📧 [EmailService] SMTP não configurado — simulando envio:');
    console.log(`   Para: ${opts.to}`);
    console.log(`   Assunto: ${opts.subject}`);
    if (opts.text) console.log(`   Conteúdo: ${opts.text}`);
    console.log('');
    return;
  }

  const transport = createTransport();
  await transport.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function resetPasswordEmail(resetUrl: string, userName: string): { html: string; text: string } {
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Redefinir sua senha</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#1877F2;padding:28px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#fff;border-radius:8px;width:32px;height:32px;text-align:center;vertical-align:middle;">
                    <span style="color:#1877F2;font-weight:bold;font-size:18px;">f</span>
                  </td>
                  <td style="padding-left:10px;color:#fff;font-size:16px;font-weight:bold;">
                    Meta Ads Agent
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 8px;font-size:22px;color:#111;">Redefinir sua senha</h1>
              <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6;">
                Olá, <strong>${userName}</strong>! Recebemos uma solicitação para redefinir a senha da sua conta.
                Clique no botão abaixo para criar uma nova senha:
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px;background:#1877F2;">
                    <a href="${resetUrl}"
                       style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:8px;">
                      Redefinir senha
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;color:#888;font-size:13px;line-height:1.6;">
                Este link expira em <strong>1 hora</strong>.
                Se você não solicitou a redefinição, pode ignorar este e-mail — sua senha não será alterada.
              </p>

              <p style="margin:16px 0 0;color:#bbb;font-size:12px;word-break:break-all;">
                Ou cole este link no navegador:<br />
                <a href="${resetUrl}" style="color:#1877F2;">${resetUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #eee;">
              <p style="margin:0;color:#aaa;font-size:12px;text-align:center;">
                Meta Ads Agent · Enviado automaticamente, não responda a este e-mail.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Meta Ads Agent — Redefinir senha\n\nOlá, ${userName}!\n\nClique no link abaixo para criar uma nova senha (válido por 1 hora):\n${resetUrl}\n\nSe não foi você, ignore este e-mail.`;

  return { html, text };
}

const SYNC_TYPE_LABELS: Record<string, string> = {
  metrics: 'Sincronização de métricas',
  status: 'Sincronização de status das campanhas',
  import: 'Importação de campanhas externas',
};

export function syncFailureAlertEmail(
  userEmail: string,
  type: string,
  details: string | null,
): { html: string; text: string } {
  const label = SYNC_TYPE_LABELS[type] ?? type;
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8" /><title>Falha de sincronização Meta Ads</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#d93025;padding:28px 40px;">
              <span style="color:#fff;font-size:16px;font-weight:bold;">⚠️ Alerta — Meta Ads Agent</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 16px;font-size:20px;color:#111;">${label} falhou 2x seguidas</h1>
              <p style="margin:0 0 8px;color:#555;font-size:15px;line-height:1.6;">
                Usuário: <strong>${userEmail}</strong>
              </p>
              <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.6;">
                A sincronização com o Meta Ads (via Pipeboard/MCP) falhou nas duas últimas tentativas.
                O dashboard deste usuário pode estar exibindo dados desatualizados.
              </p>
              ${details ? `<pre style="background:#f5f5f5;border-radius:8px;padding:12px;font-size:12px;color:#a33;white-space:pre-wrap;word-break:break-all;">${details.slice(0, 1000)}</pre>` : ''}
            </td>
          </tr>
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #eee;">
              <p style="margin:0;color:#aaa;font-size:12px;text-align:center;">Meta Ads Agent · Alerta automático de sincronização.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `[Meta Ads Agent] ${label} falhou 2x seguidas para ${userEmail}.\n\nO dashboard deste usuário pode estar exibindo dados desatualizados.\n\n${details ? `Detalhes: ${details.slice(0, 1000)}` : ''}`;

  return { html, text };
}

export function welcomeEmail(userName: string): { html: string; text: string } {
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8" /><title>Bem-vindo ao Meta Ads Agent</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#1877F2;padding:28px 40px;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="background:#fff;border-radius:8px;width:32px;height:32px;text-align:center;vertical-align:middle;">
                  <span style="color:#1877F2;font-weight:bold;font-size:18px;">f</span>
                </td>
                <td style="padding-left:10px;color:#fff;font-size:16px;font-weight:bold;">Meta Ads Agent</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 16px;font-size:22px;color:#111;">Bem-vindo, ${userName}! 🚀</h1>
              <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.6;">
                Sua conta foi criada com sucesso. Você já pode criar campanhas, gerar copies com IA e analisar seus resultados no Meta Ads.
              </p>
              <p style="margin:0;color:#888;font-size:13px;">Qualquer dúvida, estamos à disposição.</p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #eee;">
              <p style="margin:0;color:#aaa;font-size:12px;text-align:center;">Meta Ads Agent · Enviado automaticamente.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Bem-vindo ao Meta Ads Agent!\n\nOlá, ${userName}! Sua conta foi criada com sucesso.\nAcesse o app e comece a criar suas campanhas.\n\nEquipe Meta Ads Agent`;

  return { html, text };
}
