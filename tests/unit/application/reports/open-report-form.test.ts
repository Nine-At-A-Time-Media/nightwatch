import { describe, expect, it } from 'vitest';
import { openReportForm } from '../../../../src/application/reports/open-report-form.js';
import { ADA, assertionOf, PROJECT, world } from './world.js';

describe('openReportForm', () => {
  it('Reporter not asked who they are: Given a signed-in reporter, When the form opens, Then it asks for no name and no address', async () => {
    const w = world();
    expect(await openReportForm(PROJECT, assertionOf(ADA), w)).toEqual({
      reporter: { email: ADA },
      fields: ['message', 'screenshot', 'associatedEventId'],
    });
  });

  it('opens for nobody without a Sign-in the Organization trusts', async () => {
    const w = world();
    expect(await openReportForm(PROJECT, 'assertion:forged', w)).toEqual({ refusal: 'unsigned' });
    expect(await openReportForm(PROJECT, 'assertion:mallory', w)).toEqual({ refusal: 'unsigned' });
    expect(await openReportForm('project-404', assertionOf(ADA), w)).toEqual({ refusal: 'not-found' });
  });
});
