import { newChat, newInbox, tapRoute } from '../notify-core';
import { appRoute } from '../links';

const n = (id: number, read = false, link: string | null = '/orders') => ({ id, title: `N${id}`, body: 'b', link, read });
const room = (id: string, unread: number, lastId: number, sender = 2) => ({ id, title: `Room ${id}`, unread, last: { id: lastId, text: 'hi', sender_id: sender } });

describe('inbox notifications on the phone', () => {
  test('the first look announces nothing old and remembers the place', () => { const r = newInbox([n(5), n(9), n(7)], null); expect(r.show).toEqual([]); expect(r.last).toBe(9); });
  test('only unread rows newer than the place are shown, oldest first', () => {
    const r = newInbox([n(12), n(11, true), n(10), n(9)], 9);
    expect(r.show.map(s => s.key)).toEqual(['n-10', 'n-12']); expect(r.last).toBe(12); expect(r.show[0]).toMatchObject({ title: 'N10', body: 'b', url: '/orders' });
  });
  test('looking again shows nothing twice', () => { const a = newInbox([n(10), n(11)], 9); expect(newInbox([n(10), n(11)], a.last).show).toEqual([]); });
  test('a burst is folded into a few, with a count for the rest', () => {
    const r = newInbox(Array.from({ length: 10 }, (_, i) => n(i + 1)), 0);
    expect(r.show).toHaveLength(5); expect(r.show[0]).toMatchObject({ key: 'n-more', title: '6 more notifications' }); expect(r.show.slice(1).map(s => s.key)).toEqual(['n-7', 'n-8', 'n-9', 'n-10']);
  });
  test('an empty inbox keeps the place', () => { expect(newInbox([], 9)).toEqual({ show: [], last: 9 }); expect(newInbox([], null).last).toBe(0); });
  test('a row without a link opens the list', () => { expect(newInbox([n(2, false, null)], 1).show[0].url).toBe('/notifications'); });
});

describe('chat notifications on the phone', () => {
  test('the first look announces nothing', () => { const r = newChat([room('a', 3, 30)], null, 1); expect(r.show).toEqual([]); expect(r.seen).toEqual({ a: 30 }); });
  test('one per conversation with something new from someone else', () => {
    const r = newChat([room('a', 2, 31), room('b', 0, 12), room('c', 1, 40, 1), room('d', 1, 50)], { a: 30, b: 12, c: 39 }, 1);
    expect(r.show.map(s => s.key)).toEqual(['c-a', 'c-d']); expect(r.show[0]).toMatchObject({ title: 'Room a (2 new)', url: '/chat/a' }); expect(r.show[1].title).toBe('Room d');
  });
  test('the same message is not announced again', () => { const a = newChat([room('a', 1, 31)], { a: 30 }, 1); expect(newChat([room('a', 1, 31)], a.seen, 1).show).toEqual([]); });
  test('a conversation with no messages is ignored', () => { expect(newChat([{ id: 'x', title: 'X', unread: 0, last: null }], {}, 1)).toEqual({ show: [], seen: {} }); });
});

describe('where a tap leads', () => {
  const id = '0b1e7f2a-1111-2222-3333-444455556666';
  test('known pages', () => {
    expect(tapRoute('/orders', appRoute)).toBe('/orders'); expect(tapRoute('/chat', appRoute)).toBe('/chat'); expect(tapRoute(`/chat/${id}`, appRoute)).toBe(`/chat/${id}`);
    expect(tapRoute('/approvals', appRoute)).toBe('/approvals'); expect(tapRoute('/expiry', appRoute)).toBe('/offers'); expect(tapRoute('/customers/12', appRoute)).toBe('/customer/12');
  });
  test('anything else opens the notification list, never an outside address', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example/x', '/\t/evil.example', 'javascript:alert(1)', '/chat/../../login', '/unknown', '', null, undefined, 42, { url: '/orders' }]) expect(tapRoute(bad, appRoute)).toBe('/notifications');
  });
});
