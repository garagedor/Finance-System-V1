/* /home was the Gateway while / was still the CRM dashboard. The Gateway is
   now the root experience, so this redirects rather than being a second
   implementation to keep in step. The route stays so existing links and
   bookmarks do not break. */
import { redirect } from 'next/navigation';

export default function HomeAlias() {
  redirect('/');
}
