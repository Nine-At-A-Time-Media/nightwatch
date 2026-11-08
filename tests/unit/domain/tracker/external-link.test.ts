import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isRefusal } from '../../../../src/domain/refusal.js';
import {
  expectPushed,
  link,
  markBroken,
  observe,
  commentPosted,
  pushRefused,
  pushSucceeded,
  relink,
  unlink,
  type ExternalLink,
  type TrackerState,
} from '../../../../src/domain/tracker/external-link.js';

const OPEN: TrackerState = { state: 'open' };
const COMPLETED: TrackerState = { state: 'closed', reason: 'completed' };
const NOT_PLANNED: TrackerState = { state: 'closed', reason: 'not_planned' };

function linked(): ExternalLink {
  return link({ issueId: 'i1', repository: 'acme/app', number: 7, lastKnown: OPEN });
}

function asLink(value: ExternalLink | ReturnType<typeof relink>): ExternalLink {
  if (isRefusal(value)) throw new Error(value.refusal);
  return value;
}

const trackerState = fc.constantFrom(OPEN, COMPLETED, NOT_PLANNED);

describe('External Link', () => {
  it('(none) to Linked: an issue opened or linked on GitHub starts Linked, expecting nothing, with no refusals', () => {
    expect(linked()).toEqual({
      issueId: 'i1',
      repository: 'acme/app',
      number: 7,
      state: 'linked',
      lastKnown: OPEN,
      expected: null,
      refusals: 0,
    });
  });

  it('Linked to Linked: a push records the state Nightwatch expects GitHub to report back', () => {
    const pushed = expectPushed(linked(), COMPLETED);
    expect(pushed.expected).toEqual(COMPLETED);
    expect(pushed.lastKnown).toEqual(OPEN);
    const done = pushSucceeded(pushed);
    expect(done.lastKnown).toEqual(COMPLETED);
    expect(done.refusals).toBe(0);
    expect(done.state).toBe('linked');
  });

  it('Linked to Linked: an observed state becomes the last known one and clears a matching expectation only', () => {
    const pushed = expectPushed(linked(), COMPLETED);
    expect(observe(pushed, NOT_PLANNED)).toMatchObject({ lastKnown: NOT_PLANNED, expected: COMPLETED });
    expect(observe(pushed, COMPLETED)).toMatchObject({ lastKnown: COMPLETED, expected: null });
  });

  it('Linked to Broken: GitHub refuses repeatedly, up to the bound passed in', () => {
    const once = pushRefused(expectPushed(linked(), COMPLETED), { maxRefusals: 3 });
    expect(once).toMatchObject({ state: 'linked', refusals: 1 });
    const twice = pushRefused(once, { maxRefusals: 3 });
    expect(twice).toMatchObject({ state: 'linked', refusals: 2 });
    expect(pushRefused(twice, { maxRefusals: 3 })).toMatchObject({ state: 'broken', refusals: 3 });
  });

  it('Linked to Broken: a success between refusals starts the count again', () => {
    const once = pushRefused(linked(), { maxRefusals: 2 });
    const again = pushRefused(pushSucceeded(once), { maxRefusals: 2 });
    expect(again).toMatchObject({ state: 'linked', refusals: 1 });
  });

  it('Linked to Broken: a bound below one breaks the link on the first refusal', () => {
    expect(pushRefused(linked(), { maxRefusals: 0 }).state).toBe('broken');
  });

  it('Uninstalled app: Given the installation or repository is removed, Then the link is Broken and stays Broken', () => {
    const broken = markBroken(linked());
    expect(broken.state).toBe('broken');
    expect(markBroken(broken)).toEqual(broken);
    expect(pushRefused(broken, { maxRefusals: 1 })).toEqual(broken);
  });

  it('Broken link relinked: Given a Broken External Link, When a member relinks, Then it is Linked again with nothing pending', () => {
    const broken = pushRefused(expectPushed(linked(), COMPLETED), { maxRefusals: 1 });
    const again = asLink(relink(broken, { lastKnown: NOT_PLANNED }));
    expect(again).toEqual({ ...linked(), lastKnown: NOT_PLANNED });
  });

  it('Broken link relinked: relinking a link that is not Broken is refused', () => {
    expect(relink(linked(), { lastKnown: OPEN })).toEqual({ refusal: 'transition_not_allowed' });
  });

  it('Linked to (none): a member unlinks a Linked link; a Broken one is refused', () => {
    expect(unlink(linked())).toBeNull();
    expect(unlink(markBroken(linked()))).toEqual({ refusal: 'transition_not_allowed' });
  });

  it('a Broken link takes no sync: pushes and observations leave it as it is', () => {
    fc.assert(
      fc.property(trackerState, (state) => {
        const broken = markBroken(linked());
        expect(expectPushed(broken, state)).toEqual(broken);
        expect(observe(broken, state)).toEqual(broken);
        expect(pushSucceeded(broken)).toEqual(broken);
      }),
    );
  });

  it('refusals never exceed the bound and the link is Broken exactly when they reach it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 20 }), (maxRefusals, times) => {
        let current = linked();
        for (let i = 0; i < times; i++) current = pushRefused(current, { maxRefusals });
        expect(current.refusals).toBe(Math.min(times, maxRefusals));
        expect(current.state === 'broken').toBe(times >= maxRefusals);
      }),
    );
  });
});

describe('commentPosted', () => {
  it('starts the refusal count again and leaves the pending expectation and last known state alone', () => {
    const refused = pushRefused(expectPushed(linked(), COMPLETED), { maxRefusals: 3 });
    const posted = commentPosted(refused);

    expect(posted).toEqual({ ...refused, refusals: 0 });
  });

  it('leaves a Broken link Broken', () => {
    const broken = markBroken(linked());
    expect(commentPosted(broken)).toEqual(broken);
  });
});
