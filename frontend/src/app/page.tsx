import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/current-user';

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role === 'ADMIN') redirect('/admin/users');
  redirect('https://skyupnews.com');
}
