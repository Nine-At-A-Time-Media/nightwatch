import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/main.js';

type Call = { readonly input: string; readonly init: RequestInit };

const receipt = { reference: 'NW-7K2Q', status: 'received', followUpUrl: '/follow-up/NW-7K2Q' };

function placed(attributes: Readonly<Record<string, string>>): HTMLElement {
  const element = document.createElement('nightwatch-report');
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

function inShadow(element: HTMLElement, testId: string): HTMLElement {
  const found = element.shadowRoot?.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null || found === undefined) throw new Error(`no ${testId} in the shadow root`);
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('<nightwatch-report> registration', () => {
  it('registers the custom element with its styles inside a shadow root', async () => {
    const element = placed({ endpoint: '/nightwatch/report', project: 'p1' });
    await flushPromises();

    expect(customElements.get('nightwatch-report')).toBeDefined();
    expect(inShadow(element, 'report-trigger').textContent?.trim()).toBe('Report a problem');
    expect(element.shadowRoot?.querySelector('style')?.textContent).toContain('.nightwatch-report');
  });

  it('wires the page attributes and the browser fetch into a same-origin POST to the endpoint', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(receipt), { status: 201 });
    });
    const element = placed({ endpoint: '/nightwatch/report', project: 'p1', 'associated-event': 'evt-1', 'max-message-length': '50' });
    await flushPromises();

    inShadow(element, 'report-trigger').click();
    await flushPromises();
    const message = inShadow(element, 'report-message') as HTMLTextAreaElement;
    message.value = 'Totals are wrong';
    message.dispatchEvent(new Event('input'));
    element.shadowRoot?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();

    expect(calls.map((call) => [call.input, call.init.method, call.init.credentials])).toEqual([
      ['/nightwatch/report', 'POST', 'same-origin'],
    ]);
    const form = calls[0]?.init.body as FormData;
    expect(form.get('associatedEventId')).toBe('evt-1');
    expect(inShadow(element, 'report-reference').textContent).toBe('NW-7K2Q');
  });

  it('applies max-message-length from the page', async () => {
    const element = placed({ endpoint: '/nightwatch/report', project: 'p1', 'max-message-length': '5' });
    await flushPromises();
    inShadow(element, 'report-trigger').click();
    await flushPromises();
    const message = inShadow(element, 'report-message') as HTMLTextAreaElement;
    message.value = 'longer than five';
    message.dispatchEvent(new Event('input'));
    element.shadowRoot?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();

    expect(inShadow(element, 'report-failure').textContent?.trim()).toBe('Your message is too long.');
  });
});
