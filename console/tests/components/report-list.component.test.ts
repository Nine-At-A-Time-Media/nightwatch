// ReportList -- the reporter's own Reports, each linked to its Follow-up
// Page by its Report Reference, with its Report Status and filing date.
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ReportListEntry } from '#nightwatch/domain/report/filing.js';
import ReportList from '../../app/components/ReportList.vue';

const T0 = Date.UTC(2026, 10, 1, 9, 30);

function entry(reference: string, overrides: Partial<ReportListEntry> = {}): ReportListEntry {
  return {
    organizationId: 'org-1',
    projectId: 'project-1',
    reportId: `report-${reference}`,
    reference,
    message: 'the save button does nothing',
    filedAt: T0,
    status: 'received',
    ...overrides,
  };
}

describe('ReportList', () => {
  it('My reports: Given a signed-in reporter, When they open their report list, Then each Report shows with its Report Reference, linked to its Follow-up Page', () => {
    const wrapper = mount(ReportList, {
      props: { reports: [entry('ref-a'), entry('ref-b', { message: 'checkout hangs', status: 'fixed' })] },
    });
    const rows = wrapper.findAll('[data-testid="report-list-entry"]');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.text()).toContain('checkout hangs');
    expect(rows[1]?.get('[data-testid="report-list-status"]').text()).toBe('Fixed');
    expect(rows.map((row) => row.get('a').attributes('href'))).toEqual(['/follow-up/ref-a', '/follow-up/ref-b']);
    expect(rows[0]?.get('a').text()).toBe('ref-a');
    expect(rows[0]?.text()).toContain('2026-11-01 09:30 UTC');
  });

  it('says so when the reporter has filed no Report', () => {
    const wrapper = mount(ReportList, { props: { reports: [] } });
    expect(wrapper.get('[data-testid="report-list-empty"]').text()).toBe('You have not filed any reports.');
    expect(wrapper.find('[data-testid="report-list-entry"]').exists()).toBe(false);
  });

  it('encodes the reference in the link', () => {
    const wrapper = mount(ReportList, { props: { reports: [entry('a/b?c')] } });
    expect(wrapper.get('a').attributes('href')).toBe('/follow-up/a%2Fb%3Fc');
  });
});
