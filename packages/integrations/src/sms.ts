/** SMS and WhatsApp. Real providers need DLT registration in India; until then the log adapter records what would be sent. */
export interface SmsSender { send(to: string, templateId: string, vars: Record<string, string>): Promise<void> }

export class LogSmsSender implements SmsSender {
  readonly sent: { to: string; templateId: string; vars: Record<string, string> }[] = [];
  async send(to: string, templateId: string, vars: Record<string, string>) {
    this.sent.push({ to, templateId, vars });
    console.info(JSON.stringify({ level: "info", msg: "sms (not sent: DLT pending)", templateId, to: to.slice(-4) }));
  }
}
