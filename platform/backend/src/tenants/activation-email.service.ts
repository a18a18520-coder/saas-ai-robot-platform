import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket, connect as connectNet } from 'net';
import { TLSSocket, connect as connectTls } from 'tls';

type MailSocket = Socket | TLSSocket;

/** 最小 SMTP 客户端：支持 SMTPS、STARTTLS 和 AUTH LOGIN，不依赖厂商 SDK。 */
@Injectable()
export class ActivationEmailService {
  constructor(private readonly config: ConfigService) {}

  async send(to: string, tenantName: string, activationUrl: string): Promise<void> {
    const host = this.config.get<string>('SMTP_HOST');
    const from = this.config.get<string>('SMTP_FROM');
    if (!host || !from) {
      throw new ServiceUnavailableException({ code: 50301, message: 'SMTP 尚未配置，激活邮件未发送', data: null });
    }
    const port = Number(this.config.get('SMTP_PORT', 587));
    const secure = this.config.get('SMTP_SECURE', 'false') === 'true';
    const startTls = !secure && this.config.get('SMTP_STARTTLS', 'true') === 'true';
    const user = this.config.get<string>('SMTP_USER') ?? '';
    const password = this.config.get<string>('SMTP_PASSWORD') ?? '';

    let socket: MailSocket = secure
      ? connectTls({ host, port, servername: host, rejectUnauthorized: true })
      : connectNet({ host, port });
    await this.waitFor(socket, [220]);
    await this.command(socket, `EHLO ${this.config.get('SMTP_HELO_NAME', 'saas-ai-robot-platform')}`, [250]);
    if (startTls) {
      await this.command(socket, 'STARTTLS', [220]);
      socket = connectTls({ socket: socket as Socket, servername: host, rejectUnauthorized: true });
      await new Promise<void>((resolve, reject) => {
        socket.once('secureConnect', resolve);
        socket.once('error', reject);
      });
      await this.command(socket, `EHLO ${this.config.get('SMTP_HELO_NAME', 'saas-ai-robot-platform')}`, [250]);
    }
    if (user || password) {
      await this.command(socket, 'AUTH LOGIN', [334]);
      await this.command(socket, Buffer.from(user).toString('base64'), [334]);
      await this.command(socket, Buffer.from(password).toString('base64'), [235]);
    }
    await this.command(socket, `MAIL FROM:<${this.addressOnly(from)}>`, [250]);
    await this.command(socket, `RCPT TO:<${this.addressOnly(to)}>`, [250, 251]);
    await this.command(socket, 'DATA', [354]);
    socket.write(this.buildMessage(from, to, tenantName, activationUrl) + '\r\n.\r\n');
    await this.waitFor(socket, [250]);
    await this.command(socket, 'QUIT', [221]);
    socket.end();
  }

  private buildMessage(from: string, to: string, tenantName: string, activationUrl: string): string {
    const subject = this.mime(`激活 ${tenantName} 的管理员账号`);
    const safeName = this.escapeHtml(tenantName);
    const safeUrl = this.escapeHtml(activationUrl);
    const html = `<p>您好，</p><p>租户「${safeName}」已经创建。请在 24 小时内完成管理员账号激活：</p><p><a href="${safeUrl}">激活管理员账号</a></p><p>如果这不是您的操作，请忽略此邮件。</p>`;
    return [
      `From: ${from}`, `To: ${to}`, `Subject: ${subject}`,
      'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit', `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@saas-ai-robot-platform>`,
      '', html,
    ].map((line) => line.replace(/^\./gm, '..')).join('\r\n');
  }

  private command(socket: MailSocket, command: string, expected: number[]): Promise<string> {
    socket.write(command + '\r\n');
    return this.waitFor(socket, expected);
  }

  private waitFor(socket: MailSocket, expected: number[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => finish(new Error('SMTP 响应超时')), 10_000);
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        const last = lines.at(-1);
        if (!last || !/^\d{3} /.test(last)) return;
        const code = Number(last.slice(0, 3));
        if (!expected.includes(code)) finish(new Error(`SMTP 返回 ${code}: ${last.slice(4)}`));
        else finish(undefined, buffer);
      };
      const onError = (error: Error) => finish(error);
      const finish = (error?: Error, response?: string) => {
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('error', onError);
        if (error) reject(error); else resolve(response ?? '');
      };
      socket.on('data', onData);
      socket.once('error', onError);
    });
  }

  private addressOnly(value: string): string {
    return value.match(/<([^>]+)>/)?.[1] ?? value.trim();
  }

  private mime(value: string): string {
    return `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  }
}
