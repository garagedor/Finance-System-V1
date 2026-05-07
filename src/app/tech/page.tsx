import { redirect } from 'next/navigation';

export default function TechPage() {
  redirect('/tables?entity=tech');
}
