import { describe, expect, it } from 'vitest';
import { notifyFollowers } from '../../../../src/application/alerts/notify-followers.js';
import {
  BOB,
  BOB_EMAIL,
  HOUR,
  MIA,
  MIA_EMAIL,
  PROJECT,
  T0,
  alertEvent,
  arrive,
  followedIssue,
  notifyDeps,
  resolveIssue,
  world,
} from './world.js';

describe('notifyFollowers', () => {
  it('Settings respected: Given a Member set workflow notifications to never for a Project, When an issue they follow there changes, Then they are not emailed', async () => {
    const w = world();
    const issueId = await followedIssue(w);
    w.control.setNotificationSettings(MIA, { organization: { workflow: 'always' }, projects: { [PROJECT]: { workflow: 'never' } } });
    w.clock.set(T0 + HOUR);

    const sent = await notifyFollowers(PROJECT, await resolveIssue(w, issueId), notifyDeps(w));

    expect(sent.map((notification) => notification.member)).toEqual([BOB.member]);
    expect(w.mailer.sentTo(MIA_EMAIL)).toEqual([]);
    const [mail] = w.mailer.sentTo(BOB_EMAIL);
    expect(mail?.subject).toBe(`Issue ${issueId}: status changed`);
    expect(mail?.headers['Reply-To']).toMatch(/^reply\+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+@reply\.nightwatch\.example$/);
    expect(mail?.headers['In-Reply-To']).toBe(`<issue.${PROJECT}.${issueId}@mail.nightwatch.example>`);
    expect(mail?.headers['References']).toBe(`<issue.${PROJECT}.${issueId}@mail.nightwatch.example>`);
  });

  it('emails a Member who does not follow the Issue only when their setting is always', async () => {
    const w = world();
    const [signal] = await arrive(w, alertEvent(T0));
    const issueId = signal?.issueId ?? '';
    w.control.setNotificationSettings(BOB, { organization: { workflow: 'always' }, projects: {} });

    const sent = await notifyFollowers(PROJECT, await resolveIssue(w, issueId), notifyDeps(w));
    expect(sent.map((notification) => notification.member)).toEqual([BOB.member]);
  });

  it('threads every email about one Issue under one key', async () => {
    const w = world();
    const issueId = await followedIssue(w);
    await notifyFollowers(PROJECT, await resolveIssue(w, issueId), notifyDeps(w));
    const keys = new Set(w.mailer.sent.map((mail) => mail.headers['References']));
    expect(w.mailer.sent).toHaveLength(2);
    expect(keys.size).toBe(1);
  });
});
