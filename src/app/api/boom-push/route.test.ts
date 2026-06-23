import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { buildPushItem } from './route';

describe('buildPushItem', () => {
  const base = { listingId: 14447, title: 'Parking', body: 'Free after 6pm.' };

  it('builds the contract-shaped PushItem with sane defaults', () => {
    const item = buildPushItem(base, 'gerda');
    expect(item.agent).toBe('mission-control');
    expect(item.action).toBe('upsert_topic');
    expect(item.property_id).toBe(14447);
    expect(item.title).toBe('Parking');
    expect(item.body).toBe('Free after 6pm.');
    expect(item.target_url).toBe('https://app.boomnow.com/dashboard/edit/14447/services');
    expect(item.dedup).toEqual({ search_text: 'Parking' });
    expect(item.requested_by).toBe('gerda');
  });

  it('defaults audience to guest+ai visible, owners hidden', () => {
    expect(buildPushItem(base, 'mc').audience).toEqual({ guests: true, ai: true, owners: false });
  });

  it('honours an explicit audience', () => {
    const item = buildPushItem({ ...base, audience: { guests: false, owners: true } }, 'mc');
    expect(item.audience).toEqual({ guests: false, ai: true, owners: true });
  });

  it('content_hash matches sha1(property|action|title|body) over trimmed values', () => {
    const item = buildPushItem({ ...base, title: '  Parking  ', body: '  Free after 6pm.  ' }, 'mc');
    const expected = createHash('sha1').update('14447|upsert_topic|Parking|Free after 6pm.').digest('hex');
    expect(item.content_hash).toBe(expected);
    expect(item.title).toBe('Parking'); // trimmed
  });

  it('idempotency_key is stable + slugged from the title', () => {
    expect(buildPushItem({ ...base, title: 'Late Check-out!' }, 'mc').idempotency_key)
      .toBe('mc|14447|late-check-out');
  });
});
