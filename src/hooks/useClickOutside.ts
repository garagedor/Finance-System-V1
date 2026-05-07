import { useEffect, type RefObject } from 'react';

export function useClickOutside<T extends HTMLElement>(
    ref: RefObject<T | null>,
    handler: (event: MouseEvent | TouchEvent) => void
) {
    useEffect(() => {
        const listener = (event: MouseEvent | TouchEvent) => {
            const el = ref?.current;
            const target = event.target as Node;

            // Do nothing if clicking ref's element or descendent elements
            if (!el || el.contains(target)) {
                return;
            }

            // Also ignore clicks on react-datepicker elements (rendered in portal)
            const targetElement = target as HTMLElement;
            if (targetElement.closest && (
                targetElement.closest('.react-datepicker-popper') ||
                targetElement.closest('.react-datepicker__portal')
            )) {
                return;
            }

            handler(event);
        };

        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);

        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [ref, handler]);
}
