// FollowUpView -- the Follow-up Page's body: it renders the Follow-up View
// the API answered (status, shared Thread, change dates) and nothing else,
// says "not found" for a refused reference, and emits the reporter's reply.
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { FollowUpView as View } from '#nightwatch/domain/report/thread.js';
import FollowUpView from '../../app/components/FollowUpView.vue';

const T0 = Date.UTC(2026, 10, 1, 9, 30);
const HOUR = 3_600_000;

const VIEW: View = {
  status: 'acknowledged',
  thread: [
    { author: 'team', text: 'we are on it', at: T0 + 2 * HOUR },
    { author: 'you', text: 'thanks', at: T0 + 3 * HOUR },
  ],
  changes: [
    { status: 'received', at: T0 },
    { status: 'acknowledged', at: T0 + 2 * HOUR },
  ],
};

describe('FollowUpView', () => {
  it('Follow-up Page shows status: Given a Report Reference, When its reporter opens its Follow-up Page, Then they see the Report Status, the shared Thread and change dates, and nothing else about the issue', () => {
    const wrapper = mount(FollowUpView, { props: { view: VIEW, refusal: null } });
    expect(wrapper.get('[data-testid="follow-up-status"]').text()).toBe('Acknowledged');
    expect(wrapper.findAll('[data-testid="follow-up-thread-entry"]').map((entry) => entry.text())).toEqual([
      expect.stringContaining('Team'),
      expect.stringContaining('You'),
    ]);
    expect(wrapper.text()).toContain('we are on it');
    expect(wrapper.text()).toContain('thanks');
    const changes = wrapper.findAll('[data-testid="follow-up-change"]');
    expect(changes.map((change) => change.text())).toEqual(['Received 2026-11-01 09:30 UTC', 'Acknowledged 2026-11-01 11:30 UTC']);
    expect(changes[0]?.get('time').attributes('datetime')).toBe(new Date(T0).toISOString());
  });

  it('Follow-up Page refuses others: Given a refused reference, When the page renders, Then it says the report was not found and shows nothing else', () => {
    const wrapper = mount(FollowUpView, { props: { view: null, refusal: 'not-found' } });
    expect(wrapper.get('[data-testid="follow-up-not-found"]').text()).toBe('This report was not found.');
    expect(wrapper.find('[data-testid="follow-up-status"]').exists()).toBe(false);
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('asks a reporter who is not signed in to sign in', () => {
    const wrapper = mount(FollowUpView, { props: { view: null, refusal: 'unsigned' } });
    expect(wrapper.get('[data-testid="follow-up-unsigned"]').text()).toBe('Sign in to see this report.');
  });

  it('emits the reply typed in the reply box, and clears it', async () => {
    const wrapper = mount(FollowUpView, { props: { view: VIEW, refusal: null } });
    const box = wrapper.get('textarea');
    expect(box.attributes('id')).toBe(wrapper.get('label').attributes('for'));
    await box.setValue('still broken on Firefox');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('reply')).toEqual([['still broken on Firefox']]);
    expect((box.element as HTMLTextAreaElement).value).toBe('');
  });

  it('sends no blank reply', async () => {
    const wrapper = mount(FollowUpView, { props: { view: VIEW, refusal: null } });
    await wrapper.get('textarea').setValue('   ');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('reply')).toBeUndefined();
  });
});
