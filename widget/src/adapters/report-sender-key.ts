// The injection key under which the composition root (or a test) provides the Report Form's ReportSender.
import type { InjectionKey } from 'vue';
import type { ReportSender } from '../ports/report-sender.js';

export const reportSenderKey: InjectionKey<ReportSender> = Symbol('nightwatch-report-sender');
