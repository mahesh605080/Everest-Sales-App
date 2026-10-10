/** Where a web link from the server leads inside the app. */
export function appRoute(href: string): string | null {
  const [path, query = ''] = href.split('?'), q = new URLSearchParams(query);
  if (path === '/orders' && q.get('customer')) return `/order/new?${query}`;
  if (path.startsWith('/customers/')) return `/customer/${path.split('/')[2]}`;
  if (path === '/r/collections') return '/collection';
  if (path === '/approvals') return '/approvals';
  if (path === '/opportunities') return '/';
  if (path === '/expiry') return '/offers';
  return null;
}

