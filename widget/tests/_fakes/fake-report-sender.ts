// In-memory ReportSender: answers each send with the next scripted answer
// (a Filing Receipt, a Refusal, or an Error it rejects with) and records the call.
import type { Refusal } from '../../src/domain/refusal.js';
import type { FilingReceipt, ReportSubmission } from '../../src/domain/report-form.js';
import type { ReportSender } from '../../src/ports/report-sender.js';

export type ScriptedAnswer = FilingReceipt | Refusal | Error;
export type SendCall = { readonly endpoint: string; readonly submission: ReportSubmission };

export class FakeReportSender implements ReportSender {
  readonly calls: SendCall[] = [];
  readonly #answers: ScriptedAnswer[];

  constructor(answers: readonly ScriptedAnswer[]) {
    this.#answers = [...answers];
  }

  async send(endpoint: string, submission: ReportSubmission): Promise<FilingReceipt | Refusal> {
    this.calls.push({ endpoint, submission });
    const answer = this.#answers.shift();
    if (answer === undefined) throw new Error('FakeReportSender: no scripted answer left');
    if (answer instanceof Error) throw answer;
    return answer;
  }
}
