/**
 * Composition root -- registers <nightwatch-report> on the page that imports
 * this bundle, and provides the Report Form with the browser's ReportSender:
 * a same-origin fetch to the endpoint the page names. The only place that
 * names a concrete adapter.
 */

import { defineCustomElement, type App } from 'vue';
import { FetchReportSender, type FetchFunction } from './adapters/fetch-report-sender.js';
import ReportForm from './adapters/ReportForm.ce.vue';
import { reportSenderKey } from './adapters/report-sender-key.js';

// --- constants ---

const ELEMENT_NAME = 'nightwatch-report';

// Read at call time, so the page's fetch is the one used.
const browserFetch: FetchFunction = (input, init) => globalThis.fetch(input, init);

// --- wiring ---

function provideReportSender(app: App): void {
  app.provide(reportSenderKey, new FetchReportSender(browserFetch));
}

export const NightwatchReport = defineCustomElement(ReportForm, { configureApp: provideReportSender });

if (customElements.get(ELEMENT_NAME) === undefined) customElements.define(ELEMENT_NAME, NightwatchReport);
