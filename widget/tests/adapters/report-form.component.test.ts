import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReportForm from '../../src/adapters/ReportForm.ce.vue';
import { reportSenderKey } from '../../src/adapters/report-sender-key.js';
import { FakeReportSender, type ScriptedAnswer } from '../_fakes/fake-report-sender.js';

const ENDPOINT = '/nightwatch/report';
const receipt = { reference: 'NW-7K2Q', status: 'received', followUpUrl: 'https://console.example.com/follow-up/NW-7K2Q' };

function mountForm(
  answers: readonly ScriptedAnswer[],
  props: Record<string, unknown> = {},
): { wrapper: VueWrapper; sender: FakeReportSender } {
  const sender = new FakeReportSender(answers);
  const wrapper = mount(ReportForm, {
    props: { endpoint: ENDPOINT, project: 'p1', maxMessageLength: 200, ...props },
    global: { provide: { [reportSenderKey]: sender } },
  });
  return { wrapper, sender };
}

async function openWith(wrapper: VueWrapper, message: string): Promise<void> {
  await wrapper.get('[data-testid="report-trigger"]').trigger('click');
  await wrapper.get('[data-testid="report-message"]').setValue(message);
}

async function submit(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}

describe('<nightwatch-report> form', () => {
  it("Report filed in Nightwatch's form: Given a reporter in a product using Nightwatch's report form, When they submit a message, Then they see a Report Reference at once", async () => {
    const { wrapper, sender } = mountForm([receipt], { associatedEvent: 'evt-1' });
    await openWith(wrapper, 'The export button does nothing');
    await submit(wrapper);

    expect(sender.calls).toEqual([
      {
        endpoint: ENDPOINT,
        submission: { project: 'p1', message: 'The export button does nothing', screenshot: null, associatedEventId: 'evt-1' },
      },
    ]);
    expect(wrapper.get('[data-testid="report-sent"]').text()).toBe('Report sent');
    expect(wrapper.get('[data-testid="report-reference"]').text()).toBe('NW-7K2Q');
    expect(wrapper.get('[data-testid="report-follow-up"]').attributes('href')).toBe(receipt.followUpUrl);
  });

  it('Reporter not asked who they are: Given a signed-in reporter, When the form opens, Then it asks for no name and no address', async () => {
    const { wrapper } = mountForm([]);
    await wrapper.get('[data-testid="report-trigger"]').trigger('click');

    const fields = wrapper.findAll('input, textarea, select');
    expect(fields.map((field) => field.attributes('type') ?? field.element.tagName.toLowerCase())).toEqual(['textarea', 'file']);
    expect(wrapper.find('input[type="email"]').exists()).toBe(false);
    expect(wrapper.get('[role="dialog"]').text()).not.toMatch(/name|e-?mail|address/i);
    expect(wrapper.get('[data-testid="report-message"]').attributes('aria-required')).toBe('true');
  });

  it('labels the message and screenshot inputs and attaches a chosen screenshot to the submission', async () => {
    const { wrapper, sender } = mountForm([receipt]);
    await openWith(wrapper, 'Chart is blank');
    const message = wrapper.get('[data-testid="report-message"]');
    expect(wrapper.get(`label[for="${message.attributes('id')}"]`).text()).not.toBe('');
    const input = wrapper.get('[data-testid="report-screenshot"]');
    expect(input.attributes('accept')).toBe('image/png,image/jpeg');
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).not.toBe('');

    const screenshot = new File(['png'], 'shot.png', { type: 'image/png' });
    Object.defineProperty(input.element, 'files', { value: [screenshot] });
    await input.trigger('change');
    await submit(wrapper);

    expect(sender.calls[0]?.submission.screenshot).toBe(screenshot);
  });
});
